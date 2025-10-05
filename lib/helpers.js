import PhoneNumber from 'awesome-phonenumber';

/**
 * Convert LID to JID
 * @param {String} lid - LID format (contoh: 90392536080585:2@lid)
 * @param {Array} participants - Array of group participants
 * @returns {String|null} - JID format atau null
 */
export function lidToJid(lid, participants) {
    if (!lid || !lid.includes('@lid')) return null;
    
    const lidNumber = lid.split(':')[0];
    
    const participant = participants.find(p => {
        const pLidNumber = p.lid?.split(':')[0];
        return pLidNumber === lidNumber;
    });
    
    return participant?.jid || null;
}

/**
 * Get name from JID only
 * @param {String} jid - WhatsApp JID (@s.whatsapp.net)
 * @param {Array} participants - Array of group participants
 * @returns {String} - Participant name
 */
export function getParticipantName(jid, participants = []) {
    try {
        if (!jid) return 'Unknown';
        
        // pastikan input adalah JID, bukan LID
        if (jid.includes('@lid')) {
            console.warn('getParticipantName: LID detected, convert to JID first!');
            return jid.split('@')[0].split(':')[0]; // fallback ke nomor
        }
        
        // extract nomor dari jid
        const number = jid.split('@')[0];
        
        // cari participant yang match dengan JID
        const participant = participants.find(p => p.jid === jid);
        
        // prioritas: notify > pushName > formatted number
        if (participant) {
            if (participant.notify) return participant.notify;
            if (participant.pushName) return participant.pushName;
        }
        
        // fallback: format nomor pake PhoneNumber
        try {
            return PhoneNumber('+' + number).getNumber('international');
        } catch {
            return number;
        }
    } catch (error) {
        console.error('Error getting participant name:', error);
        return jid.split('@')[0];
    }
}

/**
 * Get sender that works with both JID and LID
 * @param {Object} m - Message object
 * @param {Boolean} isGroup - Is group chat
 * @param {String} from - Chat JID
 * @returns {String} - Sender JID
 */
export function getSender(m, isGroup, from) {
    if (m.key.fromMe) {
        return m.key.remoteJid.split('@')[0] + '@s.whatsapp.net';
    }
    
    if (isGroup) {
        return m.key.participantPn || m.key.participant;
    }
    
    return from;
}

/**
 * Check if user is owner
 * @param {String} sender - Sender JID
 * @param {String} senderNumber - Sender number
 * @param {String} ownerNumber - Owner number
 * @returns {Boolean}
 */
export function isOwner(sender, senderNumber, ownerNumber) {
    const ownerJid = ownerNumber + '@s.whatsapp.net';
    return sender === ownerJid || senderNumber === ownerNumber;
}

/**
 * Check if owner in group participants
 * @param {Array} participants - Group participants
 * @param {String} ownerNumber - Owner number
 * @returns {Boolean}
 */
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

/**
 * Check if bot is mentioned
 * @param {Array} mentionedJid - Mentioned JIDs
 * @param {String} text - Message text
 * @param {String} botJid - Bot JID
 * @param {String} botNumber - Bot number
 * @param {String} botLid - Bot LID (optional)
 * @returns {Boolean}
 */
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

/**
 * Clean text from mentions and replace with names
 * @param {String} text - Message text
 * @param {Array} mentionedJid - Mentioned JIDs (bisa JID atau LID)
 * @param {String} botJid - Bot JID
 * @param {String} botNumber - Bot number
 * @param {String} botLid - Bot LID (optional)
 * @param {Array} participants - Group participants
 * @returns {String} - Cleaned text
 */
export function cleanTextFromMentions(text, mentionedJid, botJid, botNumber, botLid, participants) {
    // hapus mention bot
    text = text.replace(new RegExp(`@${botNumber}\\b`, 'g'), '').trim();
    
    if (botLid) {
        const botLidNumber = botLid.split(':')[0];
        text = text.replace(new RegExp(`@${botLidNumber}\\b`, 'g'), '').trim();
    }
    
    // replace mention user lain dengan nama
    for (const mentionJid of mentionedJid) {
        // skip bot
        if (mentionJid === botJid) continue;
        if (botLid && mentionJid.replace(/:\d+@/, '@') === botLid.replace(/:\d+@/, '@')) continue;
        
        // convert LID ke JID dulu kalo perlu
        let targetJid = mentionJid;
        if (mentionJid.includes('@lid')) {
            const converted = lidToJid(mentionJid, participants);
            if (converted) {
                targetJid = converted;
            } else {
                console.warn('Failed to convert LID to JID:', mentionJid);
                // tetap lanjut pake nomor dari LID
                targetJid = mentionJid;
            }
        }
        
        // ambil nama pake JID
        const name = getParticipantName(targetJid, participants);
        
        // replace @nomor dengan nama
        const mentionNumber = mentionJid.split('@')[0].split(':')[0];
        text = text.replace(new RegExp(`@${mentionNumber}\\b`, 'g'), name);
    }
    
    return text.trim();
}