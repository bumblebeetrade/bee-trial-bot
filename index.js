const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
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
const CHECK_INTERVAL_MS = 60 * 1000;

const REMINDER_24H_MS = 24 * 60 * 60 * 1000;
const REMINDER_3H_MS = 3 * 60 * 60 * 1000;
const REMINDER_30M_MS = 30 * 60 * 1000;

const UPGRADE_URL = 'https://discord.com/channels/1155789152831418378/1490087568140795994';

// Persistent files
const DATA_DIR = path.join(__dirname, 'data');
const TRIALS_FILE = path.join(DATA_DIR, 'trials.json');
const PANEL_FILE = path.join(DATA_DIR, 'panel.json');

let isCheckingTrials = false;

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

function getTrials() {
  return readJson(TRIALS_FILE);
}

function saveTrials(data) {
  writeJson(TRIALS_FILE, data);
}

function getPanelData() {
  return readJson(PANEL_FILE);
}

function savePanelData(data) {
  writeJson(PANEL_FILE, data);
}

// =========================
// DATA SHAPE / MIGRATION
// =========================
function normalizeTrials(data) {
  let changed = false;

  for (const userId of Object.keys(data)) {
    const record = data[userId];

    if (!record || typeof record !== 'object') {
      data[userId] = {
        used: true,
        active: false,
        claimedAt: 0,
        expiresAt: 0,
        reminder24hSent: false,
        reminder3hSent: false,
        reminder30mSent: false
      };
      changed = true;
      continue;
    }

    if (record.expires && !record.expiresAt) {
      record.expiresAt = record.expires;
      delete record.expires;
      changed = true;
    }

    if (record.used === undefined) {
      record.used = true;
      changed = true;
    }

    if (record.active === undefined) {
      record.active = !!record.expiresAt && Date.now() < record.expiresAt;
      changed = true;
    }

    if (record.claimedAt === undefined) {
      record.claimedAt = Date.now();
      changed = true;
    }

    if (record.reminder24hSent === undefined) {
      record.reminder24hSent = false;
      changed = true;
    }

    if (record.reminder3hSent === undefined) {
      record.reminder3hSent = false;
      changed = true;
    }

    if (record.reminder30mSent === undefined) {
      record.reminder30mSent = false;
      changed = true;
    }

    if (record.reminded24h !== undefined) {
      delete record.reminded24h;
      changed = true;
    }
  }

  if (changed) saveTrials(data);
  return data;
}

// =========================
// PANEL
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
  const panelData = getPanelData();
  const channel = await client.channels.fetch(GET_TRIAL_CHANNEL_ID);

  if (!channel) {
    console.log('Get-trial channel not found.');
    return;
  }

  if (panelData.messageId) {
    try {
      const existingMessage = await channel.messages.fetch(panelData.messageId);

      await existingMessage.edit({
        content: PANEL_TEXT,
        components: [createTrialButtonRow()]
      });

      console.log('Existing trial panel restored.');
      return;
    } catch {
      console.log('Saved panel message not found. Creating a new one.');
    }
  }

  const newMessage = await channel.send({
    content: PANEL_TEXT,
    components: [createTrialButtonRow()]
  });

  savePanelData({ messageId: newMessage.id });
  console.log('Trial panel created and saved.');
}

// =========================
// ROLE HELPERS
// =========================
async function grantTrialRole(member) {
  if (!member.roles.cache.has(TRIAL_ROLE_ID)) {
    await member.roles.add(TRIAL_ROLE_ID);
  }
}

async function revokeTrialRole(member) {
  if (member.roles.cache.has(TRIAL_ROLE_ID)) {
    await member.roles.remove(TRIAL_ROLE_ID);
  }
}

async function grantUsedRole(member) {
  if (!member.roles.cache.has(TRIAL_USED_ROLE_ID)) {
    await member.roles.add(TRIAL_USED_ROLE_ID);
  }
}

// =========================
// EMBEDS
// =========================
function formatDiscordTimestamp(ms) {
  return `<t:${Math.floor(ms / 1000)}:F>`;
}

function formatDiscordRelative(ms) {
  return `<t:${Math.floor(ms / 1000)}:R>`;
}

function createReminderEmbed(timeText, expiresAt) {
  return new EmbedBuilder()
    .setTitle('⏳ Trial Reminder')
    .setDescription(
      `Your free trial will end in **${timeText}**.\n\n` +
      `Trial end: **${formatDiscordTimestamp(expiresAt)}** (${formatDiscordRelative(expiresAt)})`
    )
    .addFields({
      name: 'Next step',
      value: `[Upgrade to VIP](${UPGRADE_URL}) to keep your access active.`
    })
    .setColor(0xF1C40F)
    .setFooter({ text: 'Bee Trial Bot' })
    .setTimestamp();
}

function createExpiredEmbed() {
  return new EmbedBuilder()
    .setTitle('⌛ Trial Ended')
    .setDescription(
      'Your 3-day trial has ended.\n\nUpgrade to VIP to continue access.'
    )
    .addFields({
      name: 'Continue here',
      value: `[Open upgrade page](${UPGRADE_URL})`
    })
    .setColor(0xE74C3C)
    .setFooter({ text: 'Bee Trial Bot' })
    .setTimestamp();
}

// =========================
// REMINDERS
// =========================
async function sendReminder(member, record, trials, type) {
  try {
    let embed;
    let logText;

    if (type === '24h' && !record.reminder24hSent) {
      embed = createReminderEmbed('24 hours', record.expiresAt);
      record.reminder24hSent = true;
      logText = `📩 24-hour reminder sent to ${member.user.tag}.`;
    } else if (type === '3h' && !record.reminder3hSent) {
      embed = createReminderEmbed('3 hours', record.expiresAt);
      record.reminder3hSent = true;
      logText = `📩 3-hour reminder sent to ${member.user.tag}.`;
    } else if (type === '30m' && !record.reminder30mSent) {
      embed = createReminderEmbed('30 minutes', record.expiresAt);
      record.reminder30mSent = true;
      logText = `📩 30-minute reminder sent to ${member.user.tag}.`;
    } else {
      return;
    }

    await member.send({ embeds: [embed] });
    trials[member.id] = record;
    saveTrials(trials);
    await sendLog(logText);
  } catch {
    console.log(`Could not send ${type} reminder to ${member.user.tag}.`);
  }
}

// =========================
// EXPIRATION
// =========================
async function expireTrialForUserId(guild, userId, record, trials) {
  record.active = false;
  trials[userId] = record;
  saveTrials(trials);

  let member = null;
  try {
    member = await guild.members.fetch(userId);
  } catch {
    return;
  }

  try {
    await revokeTrialRole(member);
    await grantUsedRole(member);

    await sendLog(`⏰ Trial expired for ${member.user.tag}.`);

    try {
      await member.send({ embeds: [createExpiredEmbed()] });
    } catch {
      console.log(`Could not send expiration DM to ${member.user.tag}.`);
    }
  } catch (error) {
    console.error(`Failed to finalize expired trial for ${userId}:`, error);
  }
}

// =========================
// MAIN CHECKER
// =========================
async function checkTrials() {
  if (isCheckingTrials) return;
  isCheckingTrials = true;

  try {
    const now = Date.now();
    const trials = normalizeTrials(getTrials());
    const guild =
      client.guilds.cache.get(GUILD_ID) || (await client.guilds.fetch(GUILD_ID));

    for (const userId of Object.keys(trials)) {
      const record = trials[userId];
      if (!record || !record.active || !record.expiresAt) continue;

      const timeLeft = record.expiresAt - now;

      if (timeLeft <= 0) {
        await expireTrialForUserId(guild, userId, record, trials);
        continue;
      }

      let reminderType = null;

      if (timeLeft <= REMINDER_30M_MS && !record.reminder30mSent) {
        reminderType = '30m';
      } else if (timeLeft <= REMINDER_3H_MS && !record.reminder3hSent) {
        reminderType = '3h';
      } else if (timeLeft <= REMINDER_24H_MS && !record.reminder24hSent) {
        reminderType = '24h';
      }

      if (!reminderType) continue;

      let member = null;
      try {
        member = await guild.members.fetch(userId);
      } catch {
        continue;
      }

      await sendReminder(member, record, trials, reminderType);
    }
  } catch (error) {
    console.error('Error while checking trials:', error);
  } finally {
    isCheckingTrials = false;
  }
}

// =========================
// EVENTS
// =========================
client.once(Events.ClientReady, async () => {
  console.log(`Bot started as ${client.user.tag}`);

  ensureDataFiles();
  normalizeTrials(getTrials());

  await ensureTrialPanel();

  setTimeout(() => {
    checkTrials().catch((error) => {
      console.error('Initial background checkTrials failed:', error);
    });
  }, 5000);

  setInterval(() => {
    checkTrials().catch((error) => {
      console.error('Scheduled checkTrials failed:', error);
    });
  }, CHECK_INTERVAL_MS);

  console.log('Trial checker started.');
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== 'get_trial') return;

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const member = interaction.member;
    const guild = interaction.guild;

    if (!guild || !member) {
      await interaction.editReply({
        content: '❌ Guild or member data is unavailable.'
      });
      return;
    }

    const trials = normalizeTrials(getTrials());
    const existing = trials[member.id];

    if (existing) {
      if (existing.active && existing.expiresAt && Date.now() < existing.expiresAt) {
        await grantTrialRole(member);

        await interaction.editReply({
          content: '✅ Your active trial has been restored.'
        });

        await sendLog(`🔁 Active trial restored for ${member.user.tag}.`);
        return;
      }

      await interaction.editReply({
        content: '❌ You have already used your trial.'
      });
      return;
    }

    const expiresAt = Date.now() + TRIAL_DURATION_MS;

    await grantTrialRole(member);

    trials[member.id] = {
      used: true,
      active: true,
      claimedAt: Date.now(),
      expiresAt,
      reminder24hSent: false,
      reminder3hSent: false,
      reminder30mSent: false
    };

    saveTrials(trials);

    await interaction.editReply({
      content: '✅ You have received a 3-day trial!'
    });

    sendLog(`🟢 ${member.user.tag} received trial access.`).catch(console.error);
  } catch (error) {
    console.error('Interaction error:', error);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: '❌ Something went wrong. Please try again later.'
        });
      } else {
        await interaction.reply({
          content: '❌ Something went wrong. Please try again later.',
          flags: MessageFlags.Ephemeral
        });
      }
    } catch (replyError) {
      console.error('Failed to send interaction error reply:', replyError);
    }
  }
});

// =========================
// OPTIONAL DEBUG
// =========================
client.on('error', (error) => {
  console.error('Client error:', error);
});

client.on('warn', (info) => {
  console.warn('Client warning:', info);
});

client.on('shardError', (error) => {
  console.error('Shard error:', error);
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