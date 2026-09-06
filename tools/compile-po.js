#!/usr/bin/gjs -m

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

function usage() {
    printerr('Usage: gjs -m tools/compile-po.js INPUT.po OUTPUT.mo');
    imports.system.exit(2);
}

function unquotePoString(text) {
    const match = text.match(/^"(.*)"$/);
    if (!match)
        return '';

    return match[1]
        .replace(/\\"/g, '"')
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\r/g, '\r')
        .replace(/\\\\/g, '\\');
}

function parsePo(contents) {
    const entries = [];
    let current = null;
    let activeField = null;

    function finishEntry() {
        if (current && current.msgid !== undefined && current.msgstr !== undefined)
            entries.push(current);
        current = null;
        activeField = null;
    }

    for (const rawLine of contents.split(/\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
            if (!line)
                finishEntry();
            continue;
        }

        if (line.startsWith('msgid ')) {
            finishEntry();
            current = {msgid: unquotePoString(line.slice(6).trim()), msgstr: ''};
            activeField = 'msgid';
            continue;
        }

        if (line.startsWith('msgstr ')) {
            if (!current)
                throw new Error('msgstr without msgid');
            current.msgstr = unquotePoString(line.slice(7).trim());
            activeField = 'msgstr';
            continue;
        }

        if (line.startsWith('"') && current && activeField) {
            current[activeField] += unquotePoString(line);
            continue;
        }
    }

    finishEntry();
    return entries.sort((a, b) => a.msgid.localeCompare(b.msgid));
}

function encodeUtf8(text) {
    return new TextEncoder().encode(text);
}

function writeUint32(target, offset, value) {
    target[offset] = value & 0xff;
    target[offset + 1] = (value >>> 8) & 0xff;
    target[offset + 2] = (value >>> 16) & 0xff;
    target[offset + 3] = (value >>> 24) & 0xff;
}

function buildMo(entries) {
    const originals = entries.map(entry => encodeUtf8(entry.msgid));
    const translations = entries.map(entry => encodeUtf8(entry.msgstr));
    const count = entries.length;
    const headerSize = 28;
    const originalsTableOffset = headerSize;
    const translationsTableOffset = originalsTableOffset + count * 8;
    let stringsOffset = translationsTableOffset + count * 8;

    const originalOffsets = [];
    const translationOffsets = [];

    for (const original of originals) {
        originalOffsets.push(stringsOffset);
        stringsOffset += original.length + 1;
    }

    for (const translation of translations) {
        translationOffsets.push(stringsOffset);
        stringsOffset += translation.length + 1;
    }

    const output = new Uint8Array(stringsOffset);
    writeUint32(output, 0, 0x950412de);
    writeUint32(output, 4, 0);
    writeUint32(output, 8, count);
    writeUint32(output, 12, originalsTableOffset);
    writeUint32(output, 16, translationsTableOffset);
    writeUint32(output, 20, 0);
    writeUint32(output, 24, stringsOffset);

    for (let i = 0; i < count; i++) {
        writeUint32(output, originalsTableOffset + i * 8, originals[i].length);
        writeUint32(output, originalsTableOffset + i * 8 + 4, originalOffsets[i]);
        writeUint32(output, translationsTableOffset + i * 8, translations[i].length);
        writeUint32(output, translationsTableOffset + i * 8 + 4, translationOffsets[i]);
        output.set(originals[i], originalOffsets[i]);
        output.set(translations[i], translationOffsets[i]);
    }

    return output;
}

const [inputPath, outputPath] = ARGV;
if (!inputPath || !outputPath)
    usage();

const inputFile = Gio.File.new_for_path(inputPath);
const [, contents] = inputFile.load_contents(null);
const entries = parsePo(new TextDecoder().decode(contents));
const output = buildMo(entries);
const outputFile = Gio.File.new_for_path(outputPath);
const parent = outputFile.get_parent();
if (parent && !parent.query_exists(null))
    parent.make_directory_with_parents(null);
outputFile.replace_contents(output, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
