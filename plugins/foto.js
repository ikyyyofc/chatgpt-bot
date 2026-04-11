import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import axios from "axios";
import { fileTypeFromBuffer } from "file-type";
import chatAI from "../gemini.js";

const CONFIG = {
    GEMINI: {
        URL: "https://us-central1-gemmy-ai-bdc03.cloudfunctions.net/gemini",
        MODEL: "gemini-3.1-flash-image-preview",
        HEADERS: {
            "User-Agent": "okhttp/5.3.2",
            "Accept-Encoding": "gzip",
            "content-type": "application/json; charset=UTF-8"
        }
    }
};

const HAIR_DEFAULT = `long hair past the chest, soft natural S-wave (loose flowing waves — NOT tight curls, NOT straight, NOT frizzy), dark brown-to-black gradient color with subtle cool ash undertone (NOT pure black, NOT warm brown, NOT auburn, NOT highlighted), side-swept wispy bangs falling naturally across the forehead with individual strand separation, extremely high volume, individual hair strands clearly visible with natural flowing movement as if caught in a gentle breeze, silky texture with soft reflective sheen (NOT wet look, NOT dry matte)`;

const CHARACTER_NAME = `Risa Maharani`;

const IDENTITY_INLINE = `18-year-old Indonesian girl named ${CHARACTER_NAME}: light warm Southeast Asian skin (NC15-NC20), monolid almond dark-brown eyes, small delicate nose, full natural lips with subtle cupid's bow, ${HAIR_DEFAULT}, NO glasses, NO jewelry`;

const IDENTITY_LOCK_SYSTEM = `╔══════════════════════════════════════════════════╗
║         ABSOLUTE IDENTITY LOCK — PRIORITY 1      ║
╚══════════════════════════════════════════════════╝

The reference image attached to this system instruction is the SOLE authority for this character's physical identity. Every feature must be reproduced with 100% fidelity. No creative interpretation is permitted.

━━━ FACE STRUCTURE ━━━
- Face shape: reproduce exactly from reference — do NOT alter oval/round/heart proportions, jawline sharpness, cheekbone height, or forehead width by even 1mm
- Facial symmetry: match reference — do not over-symmetrize
- Facial proportions: distance between eyes, eye-to-nose, nose-to-lip, lip-to-chin — all exactly as reference

━━━ SKIN ━━━
- Tone: light warm Southeast Asian, NC15-NC20 — FORBIDDEN: tan, dark, pale white, yellow, pink, grey
- Texture: ultra-realistic — visible pores, fine surface lines, subtle skin moisture, natural uneven micro-texture
- FORBIDDEN: airbrushed, smoothed, plastic, porcelain, glass-skin, filtered look

━━━ EYES ━━━
- Lid type: monolid — FORBIDDEN: double eyelid crease, hooded lid, Western eyelid
- Shape: almond — do NOT round, do NOT enlarge, do NOT make wider or more "aesthetic"
- Color: dark brown iris — FORBIDDEN: black, hazel, amber, any lightening
- Lashes: natural length as in reference — no dramatic lash extensions
- No colored contacts, no dramatic eyeshadow unless scene prompt states it

━━━ NOSE ━━━
- Shape: small, delicate, slightly button — exact profile and front view from reference
- FORBIDDEN: narrowing, sharpening, lifting tip, widening nostrils beyond reference

━━━ LIPS ━━━
- Shape: full, natural, subtle cupid's bow — exact from reference
- FORBIDDEN: overlined, thinned, duck-lip, over-pouty
- Natural lip color matching reference unless scene prompt states makeup

━━━ HAIR — DEFAULT (override only if scene prompt explicitly changes it) ━━━
- Length: long, falls past the chest
- Texture: soft natural S-wave / loose flowing waves — FORBIDDEN: straight, tight curls, frizzy, permed, wet
- Color: dark brown-to-black gradient, cool ash undertone — FORBIDDEN: pure black, warm brown, auburn, dyed, highlighted, bleached, ombre to bright
- Bangs: wispy, side-swept, falling naturally across forehead, individual strand separation visible
- Volume: very high — hair should have body and movement, not flat
- Sheen: silky soft reflective sheen — not wet, not dull matte

━━━ ACCESSORIES & EXTRAS ━━━
- NO glasses of any kind — FORBIDDEN unless scene prompt explicitly says "wearing glasses"
- NO earrings, necklace, rings, or piercings unless scene prompt explicitly describes them
- NO makeup upgrades beyond what reference shows unless scene prompt states it

━━━ AGE ━━━
- Must appear exactly 18 years old — NOT younger (childlike/cute), NOT older (mature/womanly/adult)
- Maintain the specific youth-but-not-child quality of the reference

━━━ PHOTOREALISM STANDARDS ━━━
- Output must look like a real smartphone photo, NOT a render, NOT illustration, NOT AI art
- Candid, authentic, unposed feel — not fashion editorial, not studio portrait
- Lighting: natural and scene-matched — FORBIDDEN: ring light halo, studio softbox, dramatic spotlight
- Depth of field: NO background bokeh blur — everything rendered with natural smartphone depth
- Grain: subtle natural smartphone sensor noise acceptable and encouraged for realism
- Color: true-to-scene, no oversaturation, no LUT filter, no Instagram preset

━━━ PRE-OUTPUT VIOLATION CHECK ━━━
Before finalizing, verify ALL of the following:
[ ] Hair: soft S-wave, long past chest, dark brown-to-black cool ash gradient, wispy bangs
[ ] No glasses
[ ] No added jewelry not in scene prompt
[ ] Face shape, jawline, cheekbones exactly match reference
[ ] Skin: NC15-NC20 warm light tone, realistic texture (not airbrushed)
[ ] Eyes: monolid, almond, dark brown
[ ] Nose: small delicate button as in reference
[ ] Lips: full, natural cupid's bow as in reference
[ ] Age: appears exactly 18
[ ] Photo looks like real smartphone photo (not render/illustration)`;

const ENHANCER_SYSTEM = `You are a world-class prompt engineer specializing in photorealistic AI image generation.
Your task: expand the user's short request into a single masterfully crafted image generation prompt paragraph.
If the user request is empty, vague, or just asks for a photo/pap, invent a natural, casual, everyday selfie scenario (e.g., casual mirror selfie, bedroom, cafe, outdoor walk).

━━━ MANDATORY OUTPUT STRUCTURE ━━━
1. OPENING: Always begin with exactly: "Photorealistic candid smartphone photo of ${IDENTITY_INLINE}."
2. CAMERA & COMPOSITION: Specify camera type (front/rear), distance, angle, and framing.
3. BODY POSE & EXPRESSION: Natural pose, realistic expression.
4. CLOTHING: Detailed description of a casual, highly realistic outfit.
5. HAIR: Always include exactly: "Hair is the default identity style: ${HAIR_DEFAULT}." Describe its arrangement.
6. ENVIRONMENT & LIGHTING: Authentic lighting (e.g., indoor tungsten, overcast daylight) and real-world environment.
7. EXPOSURE & PHOTO AESTHETIC: Smartphone noise, natural imperfect shadows, unedited feel.
8. CLOSING: Always end with exactly: "Shot on smartphone camera, authentic candid real photo, natural skin texture with visible pores, no studio lighting, no bokeh blur, no beauty filter, no post-processing."

Write as ONE continuous flowing paragraph. Do NOT use bullet points. Output ONLY the prompt paragraph.`;

async function getNewToken() {
    try {
        const response = await axios.post(
            "https://www.googleapis.com/identitytoolkit/v3/relyingparty/signupNewUser?key=AIzaSyAxof8_SbpDcww38NEQRhNh0Pzvbphh-IQ",
            { clientType: "CLIENT_TYPE_ANDROID" },
            {
                headers: {
                    "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 12; SM-S9280 Build/AP3A.240905.015.A2)",
                    "Content-Type": "application/json",
                    "X-Android-Package": "com.jetkite.gemmy",
                    "X-Android-Cert": "037CD2976D308B4EFD63EC63C48DC6E7AB7E5AF2",
                    "X-Firebase-GMPID": "1:652803432695:android:c4341db6033e62814f33f2"
                }
            }
        );
        return response.data.idToken;
    } catch {
        return null;
    }
}

async function generateImage(finalPrompt, refBuffer) {
    const token = await getNewToken();
    if (!token) throw new Error("Gagal mendapatkan token autentikasi API");

    const detected = await fileTypeFromBuffer(refBuffer);
    const mimeType = detected?.mime ?? "image/jpeg";

    const partsSystem = [
        { text: IDENTITY_LOCK_SYSTEM },
        { inlineData: { mimeType, data: refBuffer.toString("base64") } }
    ];

    const partsUser = [
        {
            text: `GENERATE THE FOLLOWING IMAGE WITH MAXIMUM FIDELITY TO ALL SPECIFICATIONS:

${finalPrompt}

━━━ IDENTITY ENFORCEMENT (NON-NEGOTIABLE) ━━━
Character identity locked to reference image:
${IDENTITY_INLINE}

These attributes NEVER change regardless of scene:
- Face shape and bone structure: exact match to reference
- Skin: NC15-NC20 warm light, realistic pores and texture
- Eyes: monolid almond dark brown
- Nose: small delicate
- Lips: full natural cupid's bow
- Hair: long soft S-wave dark-brown-to-black cool ash, wispy bangs
- No glasses, no added accessories

Only these change to match the scene description:
pose · expression · clothing · hair arrangement · environment · lighting · framing · exposure`
        }
    ];

    const payload = {
        model: CONFIG.GEMINI.MODEL,
        request: {
            contents: [{ role: "user", parts: partsUser }],
            generationConfig: {
                responseModalities: ["IMAGE"],
                imageConfig: { imageSize: "2K" },
                thinkingConfig: { thinkingLevel: "HIGH" },
                temperature: 0
            },
            systemInstruction: { role: "system", parts: partsSystem }
        },
        stream: false
    };

    const { data } = await axios.post(CONFIG.GEMINI.URL, payload, {
        headers: { ...CONFIG.GEMINI.HEADERS, authorization: `Bearer ${token}` }
    });

    if (!data?.candidates?.length) throw new Error("No response candidates found");

    const parts = data.candidates[0].content.parts;
    const imagePart = parts.find(p => p.inlineData?.data);

    if (imagePart) {
        return Buffer.from(imagePart.inlineData.data, "base64");
    }

    throw new Error("No image generated by model");
}

export default {
    name: "pap",
    description: "Mengirimkan foto karakter AI sesuai konteks obrolan",
    execute: async ({ sock, from, input, message }) => {
        const refPath = path.resolve(process.cwd(), "src/char_ai.jpeg");
        
        if (!existsSync(refPath)) {
            await sock.sendMessage(from, { text: "maaf ya, foto referensiku lagi error nih..." }, { quoted: message });
            return;
        }

        const userRequest = input ? `Buatkan scene berdasarkan request ini: ${input}` : "Buatkan scene selfie casual yang natural dan random";
        const refBuffer = await fs.readFile(refPath);

        const finalPrompt = await chatAI([
            { role: "system", content: ENHANCER_SYSTEM },
            { role: "user", content: userRequest }
        ]);

        let attempt = 0;
        const maxRetries = 5;

        while (attempt < maxRetries) {
            try {
                attempt++;
                const imageBuffer = await generateImage(finalPrompt, refBuffer);

                await sock.sendMessage(
                    from,
                    { image: imageBuffer, caption: "nih fotonyaa 📸" },
                    { quoted: message }
                );
                break;
            } catch (error) {
                if (attempt >= maxRetries) {
                    await sock.sendMessage(
                        from,
                        { text: "yahh maaf fotonya gagal dikirim, coba lagi nanti yaa" },
                        { quoted: message }
                    );
                }
                await new Promise(resolve => setTimeout(resolve, 2500));
            }
        }
    }
};