import { execSync } from "child_process";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import sqlite3 from 'sqlite3'
import { open } from 'sqlite'

const path = "/home/fredo/temp/anki/Ellinika A1 (LMU).apkg"
const outPath = "/home/fredo/temp/anki/Ellinika A1 (LMU)_audio.apkg"
const textFieldName = "Greek"
const translationFieldName = "English";

// Unzip
const tmpDir = mkdtempSync(join(tmpdir(), 'anki-tts-'));
console.log(`Created tmpDir ${tmpDir}`);
console.log(tmpDir);

const findIndex = (fieldName: string, model: any): number => {
    return model.flds.findIndex((fld: any) => fld.name == fieldName);
}

const FIELD_SEPARATOR = String.fromCodePoint(31);

try {
    execSync(`unzip "${path}" -d ${tmpDir}`)
    if (existsSync(outPath)) {
        rmSync(outPath);
    }
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
        const [textFieldIndex, translationFieldIndex] = [findIndex(textFieldName, model), findIndex(translationFieldName, model)];
        if (textFieldIndex == -1 || translationFieldIndex == -1) {
            console.log(`Did not find all fields for note ${note.id}`);
            continue;
        }
        const flds = note.flds.split(FIELD_SEPARATOR);
        console.log(`Looking at ${flds[textFieldIndex]} and ${flds[translationFieldIndex]}`)
        
    }
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

