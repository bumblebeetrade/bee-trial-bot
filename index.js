const {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events
} = require('discord.js');

const express = require('express');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

const TOKEN = process.env.TOKEN;

// Channel where the trial button message should be posted
const GET_TRIAL_CHANNEL_ID = '1490087568140795994';

// Log channel name
const LOG_CHANNEL_NAME = 'trial-logs';

// Role names
const TRIAL_ROLE_NAME = 'Trial';
const TRIAL_USED_ROLE_NAME = 'Trial Used';

// Trial duration: 3 days
const TRIAL_DURATION_MS = 3 * 24 * 60 * 60 * 1000;

client.once('ready', async () => {
  console.log(`Bot started as ${client.user.tag}`);

  try {
    const channel = await client.channels.fetch(GET_TRIAL_CHANNEL_ID);

    if (!channel) {
      console.log('Channel not found.');
      return;
    }

    const button = new ButtonBuilder()
      .setCustomId('get_trial')
      .setLabel('Get Trial')
      .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder().addComponents(button);

    await channel.send({
      content:
        '🚀 **FREE TRIAL ACCESS**\n\nClick the button below to get full access to our premium channels for 3 days.',
      components: [row]
    });

    console.log('Trial button message sent successfully.');
  } catch (error) {
    console.error('Error while sending the trial button message:', error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== 'get_trial') return;

  try {
    const member = interaction.member;
    const guild = interaction.guild;

    const trialRole = guild.roles.cache.find((role) => role.name === TRIAL_ROLE_NAME);
    const trialUsedRole = guild.roles.cache.find((role) => role.name === TRIAL_USED_ROLE_NAME);
    const logChannel = guild.channels.cache.find((channel) => channel.name === LOG_CHANNEL_NAME);

    if (!trialRole || !trialUsedRole) {
      await interaction.reply({
        content: '❌ Trial roles were not found.',
        ephemeral: true
      });
      return;
    }

    if (member.roles.cache.has(trialUsedRole.id)) {
      await interaction.reply({
        content: '❌ You have already used your trial.',
        ephemeral: true
      });
      return;
    }

    if (member.roles.cache.has(trialRole.id)) {
      await interaction.reply({
        content: '⚠️ You already have an active trial.',
        ephemeral: true
      });
      return;
    }

    await member.roles.add(trialRole);

    await interaction.reply({
      content: '✅ You have received a 3-day trial!',
      ephemeral: true
    });

    if (logChannel) {
      await logChannel.send(`🟢 ${member.user.tag} received trial access.`);
    }

    setTimeout(async () => {
      try {
        const refreshedMember = await guild.members.fetch(member.id);

        if (refreshedMember.roles.cache.has(trialRole.id)) {
          await refreshedMember.roles.remove(trialRole);
          await refreshedMember.roles.add(trialUsedRole);

          if (logChannel) {
            await logChannel.send(`⏰ Trial expired for ${refreshedMember.user.tag}.`);
          }

          try {
            await refreshedMember.send(
              '⏳ Your 3-day trial has ended. Upgrade to VIP to continue access.'
            );
          } catch (dmError) {
            console.log('Could not send DM to the user.');
          }
        }
      } catch (error) {
        console.error('Error while ending the trial:', error);
      }
    }, TRIAL_DURATION_MS);
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

const app = express();

app.get('/', (req, res) => {
  res.send('Bee Trial Bot is running');
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});

console.log('Connecting to Discord...');
client.login(TOKEN).catch((error) => {
  console.error('Login error:', error);
});
