require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

process.on('unhandledRejection', (error) => {
    console.error('UNHANDLED REJECTION:', error);
});

process.on('uncaughtException', (error) => {
    console.error('UNCAUGHT EXCEPTION:', error);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

client.once('ready', () => {
    console.log(`Бот запущен как ${client.user.tag}`);
});

client.on('error', (error) => {
    console.error('CLIENT ERROR:', error);
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    const trialRoleId = '1490040277837025510';
    const usedRoleId = '1490040724539052243';

    const hadTrial = oldMember.roles.cache.has(trialRoleId);
    const hasTrial = newMember.roles.cache.has(trialRoleId);

    if (!hadTrial && hasTrial) {
        console.log(`Выдан Trial: ${newMember.user.tag}`);

        setTimeout(async () => {
            try {
                const member = await newMember.guild.members.fetch(newMember.id);

                if (member.roles.cache.has(trialRoleId)) {
                    await member.roles.remove(trialRoleId);
                    await member.roles.add(usedRoleId);

                    console.log(`Trial закончился у ${member.user.tag}`);

                    try {
                        await member.send('⏳ Your trial has ended. Upgrade to VIP to continue 🚀');
                    } catch (err) {
                        console.log('Не удалось отправить DM');
                    }
                }
            } catch (err) {
                console.error('Ошибка при завершении trial:', err);
            }
        }, 3 * 24 * 60 * 60 * 1000);
    }
});

console.log('Пробую подключиться к Discord...');
client.login(process.env.TOKEN).catch((err) => {
    console.error('LOGIN ERROR:', err);
});