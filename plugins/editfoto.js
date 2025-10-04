// plugins/editfoto.js
import axios from 'axios';
import crypto from 'crypto';
import path from 'path';
import mime from 'mime-types';

// generate UUID v4 manual
function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

const notegpt = {
    getToken: async () => {
        const config = {
          method: 'GET',
          url: 'https://notegpt.io/api/v1/oss/sts-token',
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'referer': 'https://notegpt.io/ai-image-editor',
          }
        };
        const response = await axios.request(config);
        return response.data;
    },

    uploadBuffer: async (buffer, filename = 'image.png') => {
        const tokenData = await notegpt.getToken();
        if (tokenData.code !== 100000) {
            throw new Error(`Gagal dapet token: ${tokenData.message}`);
        }

        const { AccessKeyId, AccessKeySecret, SecurityToken } = tokenData.data;
        const fileName = `${uuidv4()}${path.extname(filename) || '.png'}`;
        const bucketName = 'nc-cdn';
        const objectKey = `notegpt/web3in1/${fileName}`;
        const ossPath = `/${bucketName}/${objectKey}`;
        const uploadUrl = `https://${bucketName}.oss-us-west-1.aliyuncs.com/${objectKey}`;
        const contentType = mime.lookup(filename) || 'application/octet-stream';
        const date = new Date().toUTCString();
    
        const canonicalizedHeaders = [
            `x-oss-date:${date}`,
            `x-oss-security-token:${SecurityToken}`
        ].sort().join('\n');
        
        const stringToSign = [
            'PUT', '', contentType, date, canonicalizedHeaders, ossPath
        ].join('\n');
        
        const signature = crypto
            .createHmac('sha1', AccessKeySecret)
            .update(stringToSign)
            .digest('base64');
        
        const authorization = `OSS ${AccessKeyId}:${signature}`;    
    
        const uploadConfig = {
            method: 'PUT',
            url: uploadUrl,
            headers: {
                'Authorization': authorization,
                'Content-Type': contentType,
                'Date': date,
                'x-oss-date': date,
                'x-oss-security-token': SecurityToken,
                'User-Agent': 'Mozilla/5.0',
                'Referer': 'https://notegpt.io/',
                'Origin': 'https://notegpt.io',
            },
            data: buffer
        };
    
        const response = await axios.request(uploadConfig);
        if (response.status === 200) {
            return uploadUrl;
        } else {
            throw new Error(`Upload gagal: ${response.statusText}`);
        }
    },

    start: async (imageUrl, userPrompt) => {
        const randomUserId = uuidv4();
        const randomSessionId = uuidv4();

        const data = {
          "image_url": imageUrl,
          "type": 60,
          "user_prompt": userPrompt,
          "aspect_ratio": "match_input_image",
          "num": 1,
          "model": "google/nano-banana",
          "sub_type": 3
        };

        const config = {
          method: 'POST',
          url: 'https://notegpt.io/api/v2/images/handle',
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'Content-Type': 'application/json; charset=UTF-8',
            'origin': 'https://notegpt.io',
            'referer': `https://notegpt.io/ai-image-editor?s=${randomSessionId}`,
            'Cookie': `anonymous_user_id=${randomUserId}`
          },
          data: JSON.stringify(data)
        };

        const response = await axios.request(config);
        return { sessionInfo: { sessionId: randomSessionId, userId: randomUserId }, data: response.data };
    },

    checkStatus: async (sessionId, sessionInfo) => {
        const config = {
            method: 'GET',
            url: `https://notegpt.io/api/v2/images/status?session_id=${sessionId}`,
            headers: {
              'User-Agent': 'Mozilla/5.0',
              'referer': `https://notegpt.io/ai-image-editor?s=${sessionInfo.sessionId}`,
              'Cookie': `anonymous_user_id=${sessionInfo.userId}`
            }
        };
        const response = await axios.request(config);
        return response.data;
    },

    create: async (buffer, filename, userPrompt) => {
        try {
            const imageUrl = await notegpt.uploadBuffer(buffer, filename);
            const startResponse = await notegpt.start(imageUrl, userPrompt);

            if (startResponse.data.code !== 100000 || !startResponse.data.data.session_id) {
                throw new Error(`Gagal: ${startResponse.data.message || 'Session ID tidak ada'}`);
            }

            const sessionId = startResponse.data.data.session_id;
            const sessionInfo = startResponse.sessionInfo;

            let finalResult;
            while (true) {
                await new Promise(resolve => setTimeout(resolve, 3000));
                const statusResponse = await notegpt.checkStatus(sessionId, sessionInfo);

                if (statusResponse.code !== 100000) {
                    throw new Error(`Gagal: ${statusResponse.message}`);
                }

                const statusData = statusResponse.data;
                console.log(`   📊 Status: ${statusData.status}`);
                
                if (statusData.status === 'succeeded') {
                    finalResult = statusData;
                    break;
                }
                if (statusData.status === 'failed') {
                    throw new Error('server meledak');
                }
            }
            
            return finalResult;

        } catch (error) {
            console.error(`   ❌ gagal: ${error.message}`);
            throw error;
        }
    }
};

export default {
    description: 'Edit foto pake AI (ubah style, tambah objek, dll)',
    
    async execute({ sock, from, input, message, sender, fileBuffer }) {
        try {
            if (!input) {
                await sock.sendMessage(from, { text: 'kasih prompt nya dong! contoh: tambahkan topi' });
                return false;
            }

            if (!fileBuffer) {
                await sock.sendMessage(from, { text: 'kirim atau quote foto yang mau di-edit dong!' });
                return false;
            }

            console.log(`   🎨 Editing image with prompt: ${input}`);

            const randomFileName = `${uuidv4()}.jpg`;

            // react processing
            await sock.sendMessage(from, {
                react: {
                    text: '🎨',
                    key: message.key
                }
            });

            console.log(`   🚀 Processing with AI...`);

            const result = await notegpt.create(fileBuffer, randomFileName, input);

            if (!result.results || !result.results[0] || !result.results[0].url) {
                await sock.sendMessage(from, { text: 'gagal edit foto nih...' });
                return false;
            }

            const editedImageUrl = result.results[0].url;

            console.log(`   ✅ Image edited successfully`);

            await sock.sendMessage(from, {
                image: { url: editedImageUrl },
                caption: `✨ Done!\n\n📝 Prompt: ${input}`
            }, { quoted: message });

            console.log(`   📤 Edited image sent to ${sender}`);
            return true;

        } catch (error) {
            console.error(`   ❌ EditFoto plugin error:`, error.message);
            await sock.sendMessage(from, { text: 'error nih... coba lagi dengan prompt yang lebih jelas' });
            return false;
        }
    }
};