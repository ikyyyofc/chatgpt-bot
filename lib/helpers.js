import PhoneNumber from 'awesome-phonenumber';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const STORE_FILE = path.join(__dirname, '../participant_store.json');

let participantNameStore = new Map();

function loadStore() {
    try {
        if (fs.existsSync(STORE_FILE)) {
            const data = fs.readFileSync(STORE_FILE, 'utf8');
            participantNameStore = new Map(JSON.parse(data));
            console.log(`💾 Loaded ${participantNameStore.size} participants from store`);
        }
    } catch (error) {
        console.error('❌ Error loading participant store:', error.message);
    }
}

function saveStore() {
    try {
        const data = JSON.stringify([...participantNameStore]);
        fs.writeFileSync(STORE_FILE, data, 'utf8');
    } catch (error) {
        console.error('❌ Error saving participant store:', error.message);
    }
}

loadStore();

export function updateParticipantName(groupJid, jid, pushName) {
    if (!groupJid || !jid || !pushName) return;
    
    const key = `${groupJid}:${jid}`;
    const stored = participantNameStore.get(key);
    
    if (stored) {
        stored.pushName = pushName;
        stored.updatedAt = Date.now();
        participantNameStore.set(key, stored);
        saveStore();
        console.log(`   📝 Updated pushName for ${jid.split('@')[0]}: "${pushName}"`);
    }
}

export function updateParticipantStore(groupJid, participants) {
    if (!groupJid || !participants) return;
    
    let updated = 0;
    
    for (const participant of participants) {
        if (!participant.jid) continue;
        
        const key = `${groupJid}:${participant.jid}`;
        const existing = participantNameStore.get(key);
        
        participantNameStore.set(key, {
            jid: participant.jid,
            lid: participant.lid || null,
            notify: participant.notify || null,
            pushName: existing?.pushName || null,
            number: participant.jid.split('@')[0],
            updatedAt: Date.now()
        });
        
        updated++;
    }
    
    saveStore();
    
    console.log(`   💾 Stored ${updated} participants (total: ${participantNameStore.size})`);
}

export function lidToJid(lid, groupJid) {
    if (!lid || !lid.includes('@lid')) return null;
    
    const lidNumber = lid.split('@')[0].split(':')[0]; // extract angka dari LID
    
    console.log(`   🔍 Converting LID to JID: ${lid} (number: ${lidNumber})`);
    
    for (const [key, data] of participantNameStore.entries()) {
        if (!key.startsWith(groupJid + ':')) continue;
        
        if (data.lid) {
            const storedLidNumber = data.lid.split('@')[0].split(':')[0];
            if (storedLidNumber === lidNumber) {
                console.log(`   ✅ Found JID: ${data.jid}`);
                return data.jid;
            }
        }
    }
    
    console.log(`   ❌ LID not found in store`);
    return null;
}

export function getParticipantName(jid, groupJid) {
    try {
        if (!jid) return 'Unknown';
        
        console.log(`   🔍 Getting name for: ${jid}`);
        
        if (jid.includes('@lid')) {
            console.log(`   🔄 Converting LID to JID...`);
            const convertedJid = lidToJid(jid, groupJid);
            if (convertedJid) {
                jid = convertedJid;
                console.log(`   ✅ Converted to: ${jid}`);
            } else {
                console.log(`   ❌ Conversion failed, using LID number`);
                return jid.split('@')[0].split(':')[0];
            }
        }
        
        const number = jid.split('@')[0];
        const key = `${groupJid}:${jid}`;
        const stored = participantNameStore.get(key);
        
        console.log(`   📝 Store lookup key: ${key}`);
        console.log(`   📦 Stored data:`, stored);
        
        if (stored) {
            if (stored.pushName) {
                console.log(`   ✅ Returning pushName: "${stored.pushName}"`);
                return stored.pushName;
            }
            if (stored.notify) {
                console.log(`   ✅ Returning notify: "${stored.notify}"`);
                return stored.notify;
            }
        }
        
        console.log(`   ⚠️ No name found, formatting number`);
        
        try {
            return PhoneNumber('+' + number).getNumber('international');
        } catch {
            return number;
        }
    } catch (error) {
        console.error('❌ Error getting participant name:', error);
        return jid.split('@')[0];
    }
}

export function cleanOldEntries(maxAge = 30) {
    const maxAgeMs = maxAge * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let removed = 0;
    
    for (const [key, data] of participantNameStore.entries()) {
        if (data.updatedAt && (now - data.updatedAt) > maxAgeMs) {
            participantNameStore.delete(key);
            removed++;
        }
    }
    
    if (removed > 0) {
        saveStore();
        console.log(`🗑️  Removed ${removed} old entries from store`);
    }
}

export function getSender(m, isGroup, from) {
    if (m.key.fromMe) {
        return m.key.remoteJid.split('@')[0] + '@s.whatsapp.net';
    }
    
    if (isGroup) {
        return m.key.participantPn || m.key.participant;
    }
    
    return from;
}

export function isOwner(sender, senderNumber, ownerNumber) {
    const ownerJid = ownerNumber + '@s.whatsapp.net';
    return sender === ownerJid || senderNumber === ownerNumber;
}

export function isOwnerInGroup(participants, ownerNumber) {
    const ownerJid = ownerNumber + '@s.whatsapp.net';
    
    return participants.some(p => {
        if (p.jid === ownerJid) return true;
        if (p.id === ownerJid) return true;
        
        const idNumber = p.id?.split('@')[0];
        const jidNumber = p.jid?.split('@')[0];
        
        return idNumber === ownerNumber || jidNumber === ownerNumber;
    });
}

export function isBotMentioned(mentionedJid, text, botJid, botNumber, botLid = null) {
    if (mentionedJid.includes(botJid)) return true;
    
    if (botLid) {
        const botLidWithoutDevice = botLid.replace(/:\d+@/, '@');
        
        for (const jid of mentionedJid) {
            const mentionedWithoutDevice = jid.replace(/:\d+@/, '@');
            if (mentionedWithoutDevice === botLidWithoutDevice) return true;
        }
    }
    
    if (text.includes(`@${botNumber}`)) return true;
    
    return false;
}

export function cleanTextFromMentions(text, mentionedJid, botJid, botNumber, botLid, groupJid) {
    console.log(`   🔍 DEBUG cleanTextFromMentions:`);
    console.log(`      Original text: "${text}"`);
    console.log(`      MentionedJid:`, mentionedJid);
    
    // hapus mention bot
    text = text.replace(new RegExp(`@${botNumber}`, 'g'), '').trim();
    
    if (botLid) {
        const botLidNumber = botLid.split(':')[0];
        text = text.replace(new RegExp(`@${botLidNumber}`, 'g'), '').trim();
    }
    
    console.log(`      After removing bot: "${text}"`);
    
    for (const mentionJid of mentionedJid) {
        if (mentionJid === botJid) continue;
        if (botLid && mentionJid.replace(/:\d+@/, '@') === botLid.replace(/:\d+@/, '@')) continue;
        
        const name = getParticipantName(mentionJid, groupJid);
        const mentionNumber = mentionJid.split('@')[0].split(':')[0];
        
        console.log(`      Replacing @${mentionNumber} with "${name}"`);
        
        const beforeReplace = text;
        text = text.replace(new RegExp(`@${mentionNumber}(?=\\s|$)`, 'g'), name);
        
        if (beforeReplace !== text) {
            console.log(`      ✅ Replaced! New text: "${text}"`);
        } else {
            console.log(`      ❌ No match found for @${mentionNumber}`);
        }
    }
    
    console.log(`      Final text: "${text}"`);
    return text.trim();
}