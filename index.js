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

// ================= CONFIG =================
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

// ================= FILES =================
const DATA_DIR = path.join(__dirname, 'data');
const TRIALS_FILE = path.join(DATA_DIR, 'trials.json');
const PANEL_FILE = path.join(DATA_DIR, 'panel.json');

let isCheckingTrials = false;

// ================= FILE HELPERS =================
function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(TRIALS_FILE)) fs.writeFileSync(TRIALS_FILE, JSON.stringify({}, null, 2));
  if (!fs.existsSync(PANEL_FILE)) fs.writeFileSync(PANEL_FILE, JSON.stringify({}, null, 2));
}

function readJson(file) {
  try {
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function getTrials() { return readJson(TRIALS_FILE); }
function saveTrials(d) { writeJson(TRIALS_FILE, d); }
function getPanel() { return readJson(PANEL_FILE); }
function savePanel(d) { writeJson(PANEL_FILE, d); }

// ================= UTILS =================
function ts(ms) {
  return `<t:${Math.floor(ms / 1000)}:F>`;
}
function rel(ms) {
  return `<t:${Math.floor(ms / 1000)}:R>`;
}

// ================= VIP EMBEDS =================
function createWelcomeEmbed(username, expiresAt) {
  return new EmbedBuilder()
    .setTitle('🚀 Welcome to Bee Trade Club Trial')
    .setDescription(
      `Hey **${username}**,\n\n` +
      `Your **free 3-day trial** is now active.\n\n` +
      `⏳ Ends: ${ts(expiresAt)} (${rel(expiresAt)})`
    )
    .addFields(
      { name: '✨ Included', value: '• Premium channels\n• Trade insights\n• Full access' },
      { name: '⚠️ Important', value: 'Trial can be used only once.' },
      { name: '💎 Upgrade', value: `[Go VIP](${UPGRADE_URL})` }
    )
    .setColor(0x2ECC71)
    .setFooter({ text: 'Bee Trial Bot' })
    .setTimestamp();
}

function createReminderEmbed(time, expiresAt) {
  return new EmbedBuilder()
    .setTitle('⏳ Trial Ending Soon')
    .setDescription(
      `Your trial ends in **${time}**.\n\n` +
      `📅 ${ts(expiresAt)} (${rel(expiresAt)})`
    )
    .addFields(
      { name: '🔥 Stay inside', value: 'Upgrade to VIP to keep access.' },
      { name: '💎 Upgrade', value: `[Click here](${UPGRADE_URL})` }
    )
    .setColor(0xF1C40F)
    .setTimestamp();
}

function createExpiredEmbed() {
  return new EmbedBuilder()
    .setTitle('⌛ Trial Ended')
    .setDescription('Your trial has ended.\n\nUpgrade to continue.')
    .addFields({ name: '💎 Upgrade', value: `[Open VIP](${UPGRADE_URL})` })
    .setColor(0xE74C3C)
    .setTimestamp();
}

// ================= PANEL =================
function buttonRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('get_trial')
      .setLabel('Get Trial')
      .setStyle(ButtonStyle.Success)
  );
}

const PANEL_TEXT =
`🚀 **FREE TRIAL ACCESS**

Click the button below to get full access for 3 days.

⚠️ Trial is available only once.`;

// ================= PANEL SETUP =================
async function ensurePanel() {
  const data = getPanel();
  const ch = await client.channels.fetch(GET_TRIAL_CHANNEL_ID);

  if (data.messageId) {
    try {
      const msg = await ch.messages.fetch(data.messageId);
      await msg.edit({ content: PANEL_TEXT, components: [buttonRow()] });
      return;
    } catch {}
  }

  const msg = await ch.send({ content: PANEL_TEXT, components: [buttonRow()] });
  savePanel({ messageId: msg.id });
}

// ================= LOG =================
async function log(msg) {
  try {
    const ch = await client.channels.fetch(TRIAL_LOGS_CHANNEL_ID);
    if (ch) await ch.send(msg);
  } catch {}
}

// ================= ROLES =================
async function giveTrial(member) {
  if (!member.roles.cache.has(TRIAL_ROLE_ID))
    await member.roles.add(TRIAL_ROLE_ID);
}

async function removeTrial(member) {
  if (member.roles.cache.has(TRIAL_ROLE_ID))
    await member.roles.remove(TRIAL_ROLE_ID);
}

async function giveUsed(member) {
  if (!member.roles.cache.has(TRIAL_USED_ROLE_ID))
    await member.roles.add(TRIAL_USED_ROLE_ID);
}

// ================= CHECKER =================
async function checkTrials() {
  if (isCheckingTrials) return;
  isCheckingTrials = true;

  const trials = getTrials();
  const guild = await client.guilds.fetch(GUILD_ID);
  const now = Date.now();

  for (const id in trials) {
    const t = trials[id];
    if (!t.active) continue;

    const left = t.expiresAt - now;

    if (left <= 0) {
      t.active = false;
      saveTrials(trials);

      try {
        const m = await guild.members.fetch(id);
        await removeTrial(m);
        await giveUsed(m);
        await m.send({ embeds: [createExpiredEmbed()] });
        log(`⏰ expired ${m.user.tag}`);
      } catch {}
      continue;
    }

    try {
      const m = await guild.members.fetch(id);

      if (left < REMINDER_30M_MS && !t.r30) {
        t.r30 = true;
        m.send({ embeds: [createReminderEmbed('30 minutes', t.expiresAt)] });
      } else if (left < REMINDER_3H_MS && !t.r3) {
        t.r3 = true;
        m.send({ embeds: [createReminderEmbed('3 hours', t.expiresAt)] });
      } else if (left < REMINDER_24H_MS && !t.r24) {
        t.r24 = true;
        m.send({ embeds: [createReminderEmbed('24 hours', t.expiresAt)] });
      }

      saveTrials(trials);
    } catch {}
  }

  isCheckingTrials = false;
}

// ================= READY =================
client.once(Events.ClientReady, async () => {
  console.log(`Bot started as ${client.user.tag}`);

  ensureDataFiles();
  await ensurePanel();

  setTimeout(checkTrials, 5000);
  setInterval(checkTrials, CHECK_INTERVAL_MS);
});

// ================= BUTTON =================
client.on(Events.InteractionCreate, async (i) => {
  if (!i.isButton()) return;
  if (i.customId !== 'get_trial') return;

  await i.deferReply({ flags: MessageFlags.Ephemeral });

  const member = i.member;
  const trials = getTrials();

  if (trials[member.id]) {
    const t = trials[member.id];

    if (t.active && Date.now() < t.expiresAt) {
      await giveTrial(member);
      return i.editReply('✅ Your active trial has been restored.');
    }

    return i.editReply('❌ You already used trial.');
  }

  const expiresAt = Date.now() + TRIAL_DURATION_MS;

  await giveTrial(member);

  trials[member.id] = {
    active: true,
    expiresAt,
    r24: false,
    r3: false,
    r30: false
  };

  saveTrials(trials);

  i.editReply('✅ Trial activated!');

  member.send({ embeds: [createWelcomeEmbed(member.user.username, expiresAt)] });

  log(`🟢 ${member.user.tag} got trial`);
});

// ================= WEB =================
app.get('/', (req, res) => res.send('Bot running'));
app.listen(process.env.PORT || 10000);

ensureDataFiles();
console.log('Connecting...');
client.login(TOKEN);