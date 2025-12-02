require("dotenv").config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require("discord.js");
const fs = require("fs");
const path = require("path");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.Channel]
});

// Load clients.json
const CONFIG_PATH = path.join(__dirname, "clients.json");
function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}
function saveConfig(json) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(json, null, 2));
}

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

const PREFIX = "!";
const CHECK_EMOJI = "✅";

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();

  if (command !== "request") return;
  if (args.length === 0) {
    return message.reply("Please provide a request name.");
  }

  const requestText = args.join(" ");

  const config = loadConfig();

  // Find which client role the user has
  const userRoles = message.member.roles.cache.map(r => r.id);
  const clientRoleId = userRoles.find(rid => config.clients[rid]);

  if (!clientRoleId) {
    return message.reply("You are not assigned to any client plan.");
  }

  const clientInfo = config.clients[clientRoleId];

  // Unlimited until Jan 31
  let remaining = "999+";
  const now = new Date();
  const endOfUnlimited = new Date("2025-01-31T23:59:59");

  if (now < endOfUnlimited) {
    remaining = "999+";
  } else {
    // Normal quota mode
    const used = clientInfo.used || 0;
    const quota = clientInfo.monthlyQuota;

    let remainingNum = quota - used;
    if (remainingNum > 999) remainingNum = "999+";
    remaining = remainingNum.toString();

    // Increase usage
    if (remainingNum !== "999+") {
      clientInfo.used += 1;
      saveConfig(config);
    }
  }

  // Build the embed (PARENT CHANNEL)
  const embed = new EmbedBuilder()
    .setColor("#a855f7")
    .setTitle("🎨 New Design Request")
    .addFields(
      { name: "Request", value: requestText },
      { name: "Client", value: clientInfo.name, inline: true },
      { name: "Requested By", value: `<@${message.author.id}>`, inline: true },
      { name: "Remaining", value: remaining, inline: true }
    )
    .setTimestamp();

  const embedMessage = await message.channel.send({ embeds: [embed] });

  // Auto-react with checkmark
  await embedMessage.react(CHECK_EMOJI);

  // Create thread
  const thread = await embedMessage.startThread({
    name: `${clientInfo.name} – ${requestText}`,
    autoArchiveDuration: 1440
  });

  // First message INSIDE the thread only
  await thread.send(
    `Got it! Your request has been logged under **${clientInfo.name}**.\n` +
    `You have **${remaining}** designs remaining until your current period ends.\n` +
    `You'll be notified here when your design is complete.`
  );
});

// Handle reaction for marking complete
client.on("messageReactionAdd", async (reaction, user) => {
  if (user.bot) return;

  try {
    await reaction.fetch();
    await reaction.message.fetch();
  } catch (err) {
    return;
  }

  // Must be the checkmark
  if (reaction.emoji.name !== CHECK_EMOJI) return;

  // Must be you (the admin)
  if (user.id !== process.env.ADMIN_USER_ID) return;

  const parentMessage = reaction.message;
  const thread = parentMessage.thread;

  if (!thread) return; // no thread to delete

  // Extract request name from embed
  const embed = parentMessage.embeds[0];
  let requestName = "Unknown Request";

  if (embed && embed.fields) {
    const reqField = embed.fields.find(f => f.name === "Request");
    if (reqField) requestName = reqField.value;
  }

  // Log completion
  const completedChannel = client.channels.cache.get(process.env.COMPLETED_CHANNEL_ID);
  if (completedChannel) {
    const timestamp = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    completedChannel.send(
      `✅ **${requestName}** marked complete by <@${user.id}> at **${timestamp}**.`
    );
  }

  // Delete the THREAD only
  try {
    await thread.delete();
  } catch (err) {
    console.log("Could not delete thread:", err);
  }
});

client.login(process.env.DISCORD_TOKEN);
