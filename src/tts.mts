import { execSync } from "child_process";
import { cp, cpSync, existsSync, fstat, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { basename, dirname, join, parse } from "path";
import sqlite3 from 'sqlite3'
import { open } from 'sqlite'
import textToSpeech from '@google-cloud/text-to-speech';
import { decodeHTML } from "entities";
import * as winston from "winston";

const toUnixTimestamp = (date: Date) => {
    return parseInt((date.getTime() / 1000).toFixed(0));
}

const currentTimestamp = toUnixTimestamp(new Date());
const DIR_PATH = "/home/fredo/stack/anki v3";
const BACKUP_DIR_PATH = `${DIR_PATH}/backup`;
const PATH = `${DIR_PATH}/Ellinika A1.apkg`;
const BACKUP_FILE_NAME = `${BACKUP_DIR_PATH}/${basename(PATH)}-${currentTimestamp}`;
const OUT_PATH = `${dirname(PATH)}/${parse(PATH).name}_audio.apkg`
const textFieldName = "Greek"
const translationFieldName = "English";
const pronunciationFieldName = "Greek Pronunciation"

const myFormat = winston.format.printf((info) => {
    return `${info.timestamp}: ${info.message}`;
  });

const logger = winston.createLogger({
    level:  'debug',
    format: winston.format.combine(
        winston.format.timestamp({
          format: 'YYYY-MM-DD HH:mm:ss.SSS',
        }),
        myFormat
      ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({filename: `${BACKUP_FILE_NAME}.log`})
    ]
});

// Unzip
const tmpDir = mkdtempSync(join(tmpdir(), 'anki-tts-'));
logger.info(`Created tmpDir ${tmpDir}`);
logger.info(tmpDir);

const findIndex = (fieldName: string, model: any): number => {
    return model.flds.findIndex((fld: any) => fld.name == fieldName);
}

const FIELD_SEPARATOR = String.fromCodePoint(31);
const TTS_CACHE_PATH = join(homedir(), '.anki-tts');
if (!existsSync(TTS_CACHE_PATH)) {
    mkdirSync(TTS_CACHE_PATH);
}

const ttsClient = new textToSpeech.TextToSpeechClient();

const fixFilenameForAnkiMobile = (filename: string): string => {
    return filename.replaceAll(' ', '_')
        .replaceAll('.', '')
        .replaceAll('?', '')
        .replaceAll('!', '')
        .replaceAll('\\', '')
        .replaceAll('/', '')
        .replaceAll('\u00a0', '');
}

const toProperGreekMap = {
    'ì': 'ί',
    'í': 'ί',
    'ὶ': 'ί',
    'ὺ': 'ύ',
    'ὲ': 'έ',
    'ὼ': 'ώ',
    'ὰ': 'ά',
    'ὴ': 'ή',
    'ὸ': 'ό',
    '?': ';',
    'p': 'ρ',
    'o': 'ο',
    'a': `α`,
    'K': 'Κ'
} as {[key: string]: string}

const convertToProperGreek = (text: string): string => {
    let greekText = '';
    const htmlEntitiesPosition = [...text.matchAll(/(&\w+;)/g)].map(match => ({
        start: match.index!, 
        end: (match.index! + match[0].length) - 1
    }));

    for (let i = 0; i < text.length; i++) {
        const maybeRomanChar = text[i];
        const skip = htmlEntitiesPosition.some(position => i >= position.start  && i <= position.end);
        const greekChar = skip? maybeRomanChar:  toProperGreekMap[maybeRomanChar];
        if (greekChar != null) {
            greekText += greekChar;
        } else {
            greekText += maybeRomanChar;
        }
    }
    return greekText;
}


const transliterationMap = {
    'α': 'a',
    'ά': 'á',
    'αι': 'ae',
    'ς': 's',
    'ε': 'e',
    'έ': 'é',
    'ει': 'e',
    'ρ': 'r',
    'τ': 't',
    'υ': 'y',
    'ύ': 'ý',
    'θ': 'th',
    'ι': 'i',
    'ί': 'í',
    'ϊ': 'í',
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
    'ή': 'é',
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
    'Ἑ': 'É',
    ';': '?',
    ',': ',',
    '/': '/',
    '!': '!',
    '\'': '\'',
    '«': '\'',
    '»': '\'',
    '(': '(',
    ')': ')',
    '0': '0',
    '1': '1',
    '2': '2',
    '3': '3',
    '4': '4',
    '5': '5',
    '6': '6',
    '7': '7',
    '8': '8',
    '9': '9',
    '–': '-',
    '-': '-',
} as {[key: string]: string};

Object.entries(transliterationMap).forEach(([key, value]) => {
    transliterationMap[key.toLocaleUpperCase()] = value.toLocaleUpperCase();
    if (key.length == 2) {
        transliterationMap[`${key[0].toLocaleUpperCase()}${key[1]}`] = `${value[0].toLocaleUpperCase()}${value[0]}`;
    }

});



const transliterate = (text: string): string => {
    let transliteratedText = '';
    outerLoop:
    for (let i = 0; i < text.length;) {
        const char = text[i];
        if (char.match(/\s|\./)) {
            transliteratedText+= char;
            i++;
            continue;
        }
        const remainingText = text.substring(i);
        for (const [source, target] of Object.entries(transliterationMap)) {
            if (remainingText.startsWith(source)) {
                transliteratedText += target;
                i += source.length;
                continue outerLoop;
            }
        }
        throw new Error(`Cannot transliterate ${char} in ${text}`);
    }
    return transliteratedText;
}

// TODO Write log to file

const convertTextToSpeech = async (text: string): Promise<string> => {
    const cachePath = join(TTS_CACHE_PATH, `${text.replaceAll(/\//g, " ")}.mp3`);
    if (!existsSync(cachePath)) {
        logger.info(`${text} is not cached. Downloading`)
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
    if (!existsSync(BACKUP_DIR_PATH)) {
        mkdirSync(BACKUP_DIR_PATH);
    }
    const backups = readdirSync(BACKUP_DIR_PATH)
        .filter(fileName => fileName.endsWith('.apkg'))
    backups.sort();
    const latestBackup = backups[backups.length - 1];
    execSync(`unzip "${BACKUP_DIR_PATH}/${latestBackup}" -d ${tmpDir}`);
    const backupDb = await open({
        filename: join(tmpDir, 'collection.anki21'),
        driver: sqlite3.Database
    });
    const notesOfLastBackup  = await backupDb.all('SELECT * FROM notes');
    const numberOfNotesInLastBackup = notesOfLastBackup.length;
    const markNoteAsPresent = (id: number) => {
        const index = notesOfLastBackup.find(note => note.id == id);
        notesOfLastBackup.splice(index, 1);
    }
    await backupDb.close();
    // TODO wird wegen weiteren ZIP benötigt
    rmSync(tmpDir, {recursive: true, force: true});

    
    execSync(`unzip "${PATH}" -d ${tmpDir}`)
    if (existsSync(OUT_PATH)) {
        rmSync(OUT_PATH);
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
    await db.exec("BEGIN TRANSACTION");
    for (const note of notes) {
        markNoteAsPresent(note.id);
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
        const filterFieldIndex = findIndex('Unit', model);
        if (filterFieldIndex == -1) {
            console.warn(`Did not find filter field for note ${note.id}`);
        }
        const filterFieldValue = flds[filterFieldIndex];
        if (!["0", "1", "2", "3", "4", "5", "6", "7" ].includes(filterFieldValue)) {
            console.info(`Skipping note ${note.id}, filter field has value ${filterFieldValue}`);
            continue;
        }
        /** Filter end */

        const textFieldValue = convertToProperGreek(flds[textFieldIndex]);
        flds[textFieldIndex] = textFieldValue;

        const translationFieldValue = flds[translationFieldIndex];
        logger.info(`Looking at ${textFieldValue} and ${translationFieldValue}`);

        const decodedTextFieldValue = decodeHTML(textFieldValue);
        const speech = await convertTextToSpeech(decodedTextFieldValue);
        const mediaIndex = '' + nextMediaIndex++;
        writeFileSync(join(tmpDir, mediaIndex), speech, 'binary');
        const mediaFilename = `${fixFilenameForAnkiMobile(transliterate(decodedTextFieldValue))}.mp3`;
        media[mediaIndex] = mediaFilename;

        flds[pronunciationFieldIndex] = `[sound:${mediaFilename}]`;
        
        // Prevent apostrophes from terminating the string.
        const sql = `UPDATE notes set flds = '${flds.join(FIELD_SEPARATOR).replaceAll(/'/g, "''")}' WHERE id = ${note.id} `;
        logger.debug(`Executing ${sql}`);
        await db.exec(sql)

    }

    await db.exec("COMMIT TRANSACTION");

    if (notesOfLastBackup.length > 0) {
        throw new Error(`These notes disappeared from the last backup: \n${notesOfLastBackup.map(note => note.flds).join('\n')}`);
    }
    logger.info(`All ${numberOfNotesInLastBackup} notes from last backup still present. Currently the deck has ${notes.length} notes.`);

    writeFileSync(mediaPath, JSON.stringify(media));
    await db.close();
    execSync(`zip --junk-paths --recurse-paths "${OUT_PATH}" ${tmpDir}`);
    

    cpSync(PATH, `${BACKUP_FILE_NAME}.apkg`);
} finally {
    rmSync(tmpDir, {recursive: true, force: true});
    logger.info(`Deleted tmpDir ${tmpDir}`)
    logger.close();
}