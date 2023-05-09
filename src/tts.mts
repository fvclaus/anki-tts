import { execSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { basename, dirname, join, parse } from "path";
import sqlite3 from 'sqlite3'
import { open } from 'sqlite'
import textToSpeech from '@google-cloud/text-to-speech';
import { decodeHTML, encodeHTML } from "entities";

const path = "/home/fredo/temp/anki/Ellinika A1 Notes.apkg"
// const path = "/home/fredo/temp/anki/Ellinika A1 (LMU).apkg"
const outPath = `${dirname(path)}/${parse(path).name}_audio.apkg`
const textFieldName = "Greek"
const translationFieldName = "English";
const pronunciationFieldName = "Greek Pronunciation"

// Unzip
const tmpDir = mkdtempSync(join(tmpdir(), 'anki-tts-'));
console.log(`Created tmpDir ${tmpDir}`);
console.log(tmpDir);

const findIndex = (fieldName: string, model: any): number => {
    return model.flds.findIndex((fld: any) => fld.name == fieldName);
}

const FIELD_SEPARATOR = String.fromCodePoint(31);
const TTS_CACHE_PATH = join(homedir(), '.anki-tts');
if (!existsSync(TTS_CACHE_PATH)) {
    mkdirSync(TTS_CACHE_PATH);
}

const ttsClient = new textToSpeech.TextToSpeechClient();

const transliterationMap = {
    'α': 'a',
    'ά': 'á',
    'αι': 'ae',
    'ς': 's',
    'ε': 'e',
    'ει': 'e',
    'ρ': 'r',
    'τ': 't',
    'υ': 'y',
    'ύ': 'ý',
    'θ': 'th',
    'ι': 'i',
    'ί': 'í',
    'ο': 'o',
    'ό': 'ó',
    'οι': 'oe',
    'ou': 'u',
    'π': 'p',
    'σ': 's',
    'δ': 'd',
    'φ': 'ph',
    'γ': 'g',
    'η': 'e',
    'ξ': 'x',
    'κ': 'c',
    'λ': 'l',
    'ζ': 'z',
    'χ': 'ch',
    'ψ': 'ps',
    'ω': 'o',
    'ώ': 'ó',
    'β': 'b',
    'ν': 'n',
    'μ': 'm',
    ';': '?'
} as {[key: string]: string};

Object.entries(transliterationMap).forEach(([key, value]) => {
    transliterationMap[key.toLocaleUpperCase()] = value.toLocaleUpperCase();
    if (key.length == 2) {
        transliterationMap[`${key[0].toLocaleUpperCase()}${key[1]}`] = `${value[0].toLocaleUpperCase()}${value[0]}`;
    }

});


const transliterate = (text: string): string => {
    let transliteratedText = '';
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char.match(/\s|\./)) {
            transliteratedText+= char;
            continue;
        }
        const nextChar = text[i + 1];

        const combinedTransliteration = transliterationMap[`${char}${nextChar}`];
        const singleTransliteration = transliterationMap[char];
        if (combinedTransliteration != null) {
            transliteratedText += combinedTransliteration;
            i++;
        } else if (singleTransliteration != null) {
            transliteratedText += singleTransliteration;
        } else {
            throw new Error(`Cannot transliterate ${char} in ${text}`);
        }
    }
    return transliteratedText;
}

const convertTextToSpeech = async (text: string): Promise<string> => {
    const cachePath = join(TTS_CACHE_PATH, `${text}.mp3`);
    if (!existsSync(cachePath)) {
        console.log(`${text} is not cached. Downloading`)
        const [response] = await ttsClient.synthesizeSpeech({
            input: {
                text
            },
            voice: {
                languageCode: 'el-GR'
            },
            audioConfig: {
                audioEncoding: 'MP3'
            }
        });
        if (!response.audioContent) {
            throw new Error(`Did not receive proper response`);
        }
        writeFileSync(cachePath, response.audioContent, 'binary');
    }

    return readFileSync(cachePath, {encoding: 'binary'})
}

try {
    execSync(`unzip "${path}" -d ${tmpDir}`)
    if (existsSync(outPath)) {
        rmSync(outPath);
    }
    const mediaPath = join(tmpDir, 'media');
    const media = JSON.parse(readFileSync(mediaPath).toString());
    let nextMediaIndex = Object.keys(media).map(key => parseInt(key, 10)).sort((a, b) => b -a)[0] || 1;
    const db = await open({
        filename: join(tmpDir, 'collection.anki21'),
        driver: sqlite3.Database
    });
    const cols  = await db.all('SELECT * FROM col');
    if (cols.length != 1) {
        throw new Error(`Expected exactly 1 col`);
    }
    const models = JSON.parse(cols[0]["models"]);
    const notes  = await db.all('SELECT * FROM notes');
    for (const note of notes) {
        const model = models[note.mid];
        if (model == null) {
            throw new Error(`Did not find model for note ${note.id}`)
        }
        const [textFieldIndex, translationFieldIndex, pronunciationFieldIndex] = [findIndex(textFieldName, model), findIndex(translationFieldName, model), findIndex(pronunciationFieldName, model)];
        if (textFieldIndex == -1 || translationFieldIndex == -1 || pronunciationFieldIndex == -1) {
            console.warn(`Did not find all fields for note ${note.id}`);
            continue;
        }
        const flds = note.flds.split(FIELD_SEPARATOR);
        /** Filter start */
        // const filterFieldIndex = findIndex('Unit', model);
        // if (filterFieldIndex == -1) {
        //     console.warn(`Did not find filter field for note ${note.id}`);
        // }
        // const filterFieldValue = flds[filterFieldIndex];
        // if (!["0", "1"].includes(filterFieldValue)) {
        //     console.info(`Skipping note ${note.id}, filter field has value ${filterFieldValue}`);
        //     continue;
        // }
        /** Filter end */

        const textFieldValue = flds[textFieldIndex];
        const translationFieldValue = flds[translationFieldIndex];
        console.log(`Looking at ${textFieldValue} and ${translationFieldValue}`);

        const decodedTextFieldValue = decodeHTML(textFieldValue);
        const speech = await convertTextToSpeech(decodedTextFieldValue);
        const mediaIndex = '' + nextMediaIndex++;
        writeFileSync(join(tmpDir, mediaIndex), speech, 'binary');
        const mediaFilename = `${transliterate(decodedTextFieldValue).replaceAll(' ', '_').replaceAll(/\.|\?/g, '')}.mp3`
        media[mediaIndex] = mediaFilename;

        flds[pronunciationFieldIndex] = `[sound:${mediaFilename}]`;

        db.exec(`UPDATE notes set flds = '${flds.join(FIELD_SEPARATOR)}' WHERE id = ${note.id} `)

    }

    writeFileSync(mediaPath, JSON.stringify(media));
    await db.close();
    execSync(`zip --junk-paths --recurse-paths "${outPath}" ${tmpDir}`)
} finally {
    rmSync(tmpDir, {recursive: true, force: true});
    console.log(`Deleted tmpDir ${tmpDir}`)
}
// Open collection
// Find fields array
// Iterate through cards
// Extract foreign field
// Translate
// Store mp3 as media
// Update media file
// Update note
// Zip

