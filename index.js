const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events
} = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const app = express();

// =========================
// CONFIG
// =========================
const TOKEN = process.env.TOKEN;

const GUILD_ID = '1155789152831418378';
const GET_TRIAL_CHANNEL_ID = '1490087568140795994';
const TRIAL_LOGS_CHANNEL_ID = '1490433692827385997';

const TRIAL_ROLE_ID = '1490040277837025510';
const TRIAL_USED_ROLE_ID = '1490040724539052243';

const TRIAL_DURATION_MS = 3 * 24 * 60 * 60 * 1000;

// Persistent files on Render disk
const DATA_DIR = path.join(__dirname, 'data');
const TRIALS_FILE = path.join(DATA_DIR, 'trials.json');
const PANEL_FILE = path.join(DATA_DIR, 'panel.json');

// =========================
// FILE HELPERS
// =========================
function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(TRIALS_FILE)) {
    fs.writeFileSync(TRIALS_FILE, JSON.stringify({}, null, 2));
  }

  if (!fs.existsSync(PANEL_FILE)) {
    fs.writeFileSync(PANEL_FILE, JSON.stringify({}, null, 2));
  }
}

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error(`Failed to read JSON from ${filePath}:`, error);
    return {};
  }
}

function writeJson(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Failed to write JSON to ${filePath}:`, error);
  }
}

// =========================
// BUTTON PANEL
// =========================
function createTrialButtonRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('get_trial')
      .setLabel('Get Trial')
      .setStyle(ButtonStyle.Success)
  );
}

const PANEL_TEXT =
  '🚀 **FREE TRIAL ACCESS**\n\nClick the button below to get full access for 3 days.\n\n⚠️ Trial is available only once.';

// =========================
// LOGGING
// =========================
async function sendLog(message) {
  try {
    const channel = await client.channels.fetch(TRIAL_LOGS_CHANNEL_ID);
    if (!channel) return;
    await channel.send(message);
  } catch (error) {
    console.error('Failed to send log message:', error);
  }
}

// =========================
// PANEL MANAGEMENT
// =========================
async function ensureTrialPanel() {
  const panelData = readJson(PANEL_FILE);
  const channel = await client.channels.fetch(GET_TRIAL_CHANNEL_ID);

  if (!channel) {
    console.log('Get-trial channel not found.');
    return;
  }

  // Try to reuse existing panel
  if (panelData.messageId) {
    try {
      const existingMessage = await channel.messages.fetch(panelData.messageId);

      await existingMessage.edit({
        content: PANEL_TEXT,
        components: [createTrialButtonRow()]
      });

      console.log('Existing trial panel restored.');
      return;
    } catch (error) {
      console.log('Previous panel message not found, creating a new one.');
    }
  }

  // Create new panel if none exists
  const newMessage = await channel.send({
    content: PANEL_TEXT,
    components: [createTrialButtonRow()]
  });

  writeJson(PANEL_FILE, { messageId: newMessage.id });
  console.log('Trial panel created and saved.');
}

// =========================
// TRIAL STORAGE
// =========================
function getTrials() {
  return readJson(TRIALS_FILE);
}

function saveTrials(data) {
  writeJson(TRIALS_FILE, data);
}

// =========================
// EXPIRE CHECK
// =========================
async function checkExpiredTrials() {
  try {
    const trials = getTrials();
    const guild = await client.guilds.fetch(GUILD_ID);

    for (const userId of Object.keys(trials)) {
      const record = trials[userId];

      if (!record || !record.expiresAt) continue;
      if (Date.now() < record.expiresAt) continue;

      try {
        const member = await guild.members.fetch(userId);

        if (member.roles.cache.has(TRIAL_ROLE_ID)) {
          await member.roles.remove(TRIAL_ROLE_ID);
        }

        if (!member.roles.cache.has(TRIAL_USED_ROLE_ID)) {
          await member.roles.add(TRIAL_USED_ROLE_ID);
        }

        await sendLog(`⏰ Trial expired for ${member.user.tag}.`);

        try {
          await member.send(
            '⏳ Your 3-day trial has ended. Upgrade to VIP to continue access.'
          );
        } catch {
          console.log(`Could not send DM to ${member.user.tag}.`);
        }
      } catch (error) {
        console.error(`Failed to expire trial for user ${userId}:`, error);
      } finally {
        delete trials[userId];
        saveTrials(trials);
      }
    }
  } catch (error) {
    console.error('Error while checking expired trials:', error);
  }
}

// =========================
// DISCORD EVENTS
// =========================
client.once(Events.ClientReady, async () => {
  console.log(`Bot started as ${client.user.tag}`);

  ensureDataFiles();
  await ensureTrialPanel();
  await checkExpiredTrials();

  setInterval(checkExpiredTrials, 60 * 1000);
  console.log('Trial expiration checker started.');
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== 'get_trial') return;

  try {
    const member = interaction.member;
    const guild = interaction.guild;
    const trials = getTrials();

    if (!guild || !member) {
      await interaction.reply({
        content: '❌ Guild or member data is unavailable.',
        ephemeral: true
      });
      return;
    }

    if (member.roles.cache.has(TRIAL_USED_ROLE_ID) || trials[member.id]) {
      await interaction.reply({
        content: '❌ You have already used your trial.',
        ephemeral: true
      });
      return;
    }

    if (member.roles.cache.has(TRIAL_ROLE_ID)) {
      await interaction.reply({
        content: '⚠️ You already have an active trial.',
        ephemeral: true
      });
      return;
    }

    await member.roles.add(TRIAL_ROLE_ID);

    trials[member.id] = {
      guildId: guild.id,
      expiresAt: Date.now() + TRIAL_DURATION_MS
    };
    saveTrials(trials);

    await interaction.reply({
      content: '✅ You have received a 3-day trial!',
      ephemeral: true
    });

    await sendLog(`🟢 ${member.user.tag} received trial access.`);
  } catch (error) {
    console.error('Interaction error:', error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Something went wrong. Please try again later.',
        ephemeral: true
      });
    }
  }
});

// =========================
// RENDER WEB SERVER
// =========================
app.get('/', (req, res) => {
  res.send('Bee Trial Bot is running');
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});

// =========================
// START
// =========================
ensureDataFiles();

console.log('Connecting to Discord...');
client.login(TOKEN).catch((error) => {
  console.error('Login error:', error);
});