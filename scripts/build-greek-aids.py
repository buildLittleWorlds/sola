#!/usr/bin/env python3
"""Build offline Greek memory aids against the immutable app corpus.

No network requests or third-party installation are performed by this builder.
Source downloads and the vendored MIT syllabifier are SHA-256 pinned in
sources/aids/greek/source-lock.json.  Run --check to verify committed outputs.
"""
from __future__ import annotations

import argparse
import collections
import csv
import hashlib
import json
import re
import sys
import unicodedata as ud
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / "sources/aids/greek"
sys.path.insert(0, str(ROOT / "scripts/greek-aids"))
from greek_accentuation.syllabify import syllabify  # noqa: E402

MACULA_REF = re.compile(r"(\w+) (\d+):(\d+)!(\d+)")
STEP_REF = re.compile(r"([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)(?:[^#]*)#([^=]+)=(.+)")
APOSTROPHES = "'’ʼ᾽᾿"
ACCENTS = "\u0300\u0301\u0342"
LETTER_MAP = dict(zip("αβγδεζηθικλμνξοπρσςτυφχψω",
    ["a", "b", "g", "d", "e", "z", "ē", "th", "i", "k", "l", "m", "n", "x", "o", "p", "r", "s", "s", "t", "y", "ph", "ch", "ps", "ō"]))
BOOK_MAP = {"Mat": "MAT", "Mrk": "MRK", "Luk": "LUK", "Jhn": "JHN", "Act": "ACT", "Rom": "ROM",
    "1Co": "1CO", "2Co": "2CO", "Gal": "GAL", "Eph": "EPH", "Php": "PHP", "Col": "COL",
    "1Th": "1TH", "2Th": "2TH", "1Ti": "1TI", "2Ti": "2TI", "Tit": "TIT", "Phm": "PHM",
    "Heb": "HEB", "Jas": "JAS", "1Pe": "1PE", "2Pe": "2PE", "1Jn": "1JN", "2Jn": "2JN", "3Jn": "3JN", "Jud": "JUD", "Rev": "REV"}


def nfc(text: str) -> str:
    return ud.normalize("NFC", text)


def surface(text: str, lower: bool = False) -> str:
    """Ignore punctuation for alignment only; retain every vowel and accent."""
    text = text.lower() if lower else text
    return nfc("".join(c for c in text if c not in APOSTROPHES and ud.category(c)[0] in "LM"))


def letters(text: str) -> str:
    """Diagnostic key only: never sufficient to authorize gloss alignment."""
    return "".join(c for c in ud.normalize("NFD", surface(text, True)) if ud.category(c)[0] == "L")


def transliterate_syllable(text: str, following: str = "") -> str:
    clusters: list[list[str]] = []
    for c in ud.normalize("NFD", text):
        if ud.category(c).startswith("M") and clusters:
            clusters[-1].append(c)
        else:
            clusters.append([c])
    bases = [x[0].lower() for x in clusters]
    result: list[str] = []
    for i, cluster in enumerate(clusters):
        original, *marks = cluster
        base = original.lower()
        if base not in LETTER_MAP:
            raise ValueError(f"Unmapped Greek letter {original!r}")
        latin = LETTER_MAP[base]
        next_base = bases[i + 1] if i + 1 < len(bases) else letters(following)[:1]
        if base == "γ" and next_base and next_base in "γκξχ":
            latin = "n"
        if base == "υ" and "\u0308" not in marks and ((i > 0 and bases[i - 1] in "αεηο") or (i + 1 < len(bases) and bases[i + 1] == "ι")):
            latin = "u"
        if "\u0345" in marks:
            latin += "i"
        if "\u0314" in marks:
            if base == "ρ":
                latin += "h"
            elif i == 1 and bases[0] in "αεηιουω":
                # Rough breathing is written on the second vowel of a diphthong.
                initial_capital = clusters[0][0].isupper()
                result[0] = result[0].lower()
                result.insert(0, "H" if initial_capital else "h")
            else:
                latin = "h" + latin
        if original.isupper():
            latin = latin[0].upper() + latin[1:]
        result.append(latin)
    return "".join(result)


def pronunciation(text: str) -> dict:
    clean = surface(text)
    try:
        greek = syllabify(clean)
        if not greek or nfc("".join(greek)) != clean:
            raise ValueError("Syllabification did not preserve source letters")
        latin = [transliterate_syllable(s, greek[i + 1] if i + 1 < len(greek) else "") for i, s in enumerate(greek)]
        stressed = [i for i, s in enumerate(greek) if any(c in ACCENTS for c in ud.normalize("NFD", s))]
        if any(c in APOSTROPHES for c in text):
            latin[-1] += "’"
        result = {"syllables": latin, "stressed": stressed, "status": "written-accent"}
        if not stressed:
            result["note"] = "No accent is written on this form; no independent stress has been added."
        elif len(stressed) > 1:
            result["note"] = "Both written accents are shown, including the accent associated with a following enclitic."
        return result
    except (ValueError, IndexError, TypeError) as exc:
        return {"syllables": [], "stressed": [], "status": "pronunciation-unconfirmed", "note": str(exc)}


def clean_gloss(value: str) -> str | None:
    value = " ".join(value.split())
    if (not value or not any(c.isalnum() for c in value)
            or value.casefold().strip(". ") in {"n/a", "n.a", "n / a", "null", "undefined"}
            or any(mark in value for mark in ("*", "~", "...", "…", "{", "}", "_"))):
        return None
    # Preserve source brackets as visible explanatory text, never HTML.
    value = re.sub(r"<([^<>]+)>", r"(\1)", value)
    if "<" in value or ">" in value:
        return None
    value = value.strip(".,;:!?¶ ")
    return value or None


def grammatical_marker(row: dict) -> str | None:
    """Explain an untranslated article only when three source fields agree."""
    if row["class"] == "det" and row["morph"].startswith("T-") and nfc(row["lemma"]) == "ὁ":
        return "(article: the)"
    return None


def grammar_label(row: dict) -> str:
    classes = {"noun": "noun", "verb": "verb", "det": "article", "conj": "conjunction",
               "pron": "pronoun", "prep": "preposition", "adj": "adjective", "adv": "adverb",
               "ptcl": "particle", "num": "number", "intj": "interjection"}
    kind = classes.get(row["class"], row["class"])
    if row["type"] and row["type"] != "common":
        kind = row["type"] + " " + kind
    groups = [kind]
    if row["class"] == "verb":
        verbal = " ".join(row[k] for k in ("tense", "voice", "mood") if row[k])
        if verbal:
            groups.append(verbal)
    nominal = " ".join(row[k] for k in ("case", "gender", "number") if row[k])
    if nominal:
        groups.append(nominal)
    if row["person"]:
        groups.append(row["person"] + " person")
    return "; ".join(groups) or row["morph"]


def verify_sources() -> dict:
    lock = json.loads((SOURCES / "source-lock.json").read_text())
    for item in lock["files"]:
        actual = hashlib.sha256((ROOT / item["file"]).read_bytes()).hexdigest()
        if actual != item["sha256"]:
            raise ValueError(f"Source checksum mismatch: {item['file']}")
    return lock


def load_macula() -> dict:
    result = collections.defaultdict(list)
    with (SOURCES / "macula-sblgnt.tsv").open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            match = MACULA_REF.fullmatch(row["ref"])
            if not match:
                raise ValueError(f"Unrecognized MACULA reference: {row['ref']}")
            book, chapter, verse, word = match.groups()
            result[(book, int(chapter), int(verse))].append((int(word), row))
    ordered = {}
    for key, values in result.items():
        values.sort(key=lambda x: x[0])
        if [x[0] for x in values] != list(range(1, len(values) + 1)):
            raise ValueError(f"Duplicate or missing source word index: {key}")
        ordered[key] = [x[1] for x in values]
    return ordered


def load_step() -> dict:
    result = collections.defaultdict(list)
    for filename in ["TAGNT-Mat-Jhn.txt", "TAGNT-Act-Rev.txt"]:
        with (SOURCES / filename).open(encoding="utf-8-sig") as f:
            for line in f:
                cols = line.rstrip("\n").split("\t")
                match = STEP_REF.fullmatch(cols[0])
                if not match or len(cols) < 6:
                    continue
                book, chapter, verse, _, _ = match.groups()
                if book not in BOOK_MAP:
                    continue
                # The spelling follows other editions; only same-surface matches
                # in the exact verse can be used. Never filter on SBL alone.
                text = cols[1].split(" (")[0]
                result[(BOOK_MAP[book], int(chapter), int(verse))].append({
                    "ref": cols[0], "text": text, "gloss": clean_gloss(cols[2]),
                    "lemma": cols[4].split("=")[0], "grammar": cols[3].split("=")[-1],
                    "editions": cols[5],
                })
    return result


def fallback_gloss(token: dict, row: dict, targets: list, candidates: list) -> tuple[str | None, str | None]:
    """Conservative verse-local transfer. Repeated/ambiguous matches stay blank."""
    form = surface(token["text"], True)
    if sum(surface(t["text"], True) == form for t in targets) != 1:
        return None, None
    matches = [c for c in candidates if surface(c["text"], True) == form
               and letters(c["lemma"]) == letters(row["lemma"]) and c["gloss"]]
    # A source lexical row may not be chosen just because it looks plausible.
    if len(matches) != 1:
        return None, None
    return matches[0]["gloss"], matches[0]["ref"]


def encoded(data: dict) -> bytes:
    return (json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n").encode()


def build(check: bool = False) -> dict:
    lock = verify_sources()
    index = json.loads((ROOT / "public/corpus/index.json").read_text())
    forms = json.loads((SOURCES / "reviewed-form-exceptions.json").read_text())
    gloss_overrides = json.loads((SOURCES / "reviewed-gloss-overrides.json").read_text())
    macula, step = load_macula(), load_step()
    stats = collections.Counter()
    audit = {"schemaVersion": 1, "corpusHash": index["contentHash"],
             "maculaCommit": lock["maculaCommit"], "stepCommit": lock["stepCommit"],
             "greekAccentuationCommit": lock["greekAccentuationCommit"],
             "formExceptions": [], "grammaticalMarkers": [], "glossFallbacks": [], "unavailableGlosses": [],
             "unconfirmedPronunciations": [], "books": []}
    seen_refs, used_forms, used_glosses = set(), set(), set()
    outputs = {}
    for book in index["books"]:
        if book["testament"] != "NT":
            continue
        book_id = book["id"]
        data = {"schemaVersion": 1, "bookId": book_id, "corpusHash": index["contentHash"], "chapters": {}}
        chapter_list = json.loads((ROOT / "public/corpus" / f"{book_id}.json").read_text())
        book_count = 0
        for chapter in chapter_list:
            verses = collections.defaultdict(list)
            for token in chapter["tokens"]:
                verses[token["verse"]].append(token)
            chapter_aids = {}
            for verse, tokens in verses.items():
                ref = (book_id, chapter["number"], verse)
                seen_refs.add(ref)
                rows = macula.get(ref, [])
                if len(rows) != len(tokens):
                    raise ValueError(f"Word count mismatch at {ref}: {len(tokens)} vs {len(rows)}")
                for token, row in zip(tokens, rows):
                    word_ref = f"{book_id} {chapter['number']}:{verse}!{token['sourceIndex'] + 1}"
                    if row["ref"] != word_ref:
                        raise ValueError(f"Source index mismatch {row['ref']} vs {word_ref}")
                    sources = ["macula-sblgnt", "greek-accentuation"]
                    notes = []
                    if surface(token["text"]) != surface(row["text"]):
                        exception = forms.get(word_ref)
                        if not exception or nfc(exception["original"]) != nfc(token["text"]) or nfc(exception["macula"]) != nfc(row["text"]):
                            raise ValueError(f"Unreviewed source form difference {word_ref}: {token['text']} / {row['text']}")
                        used_forms.add(word_ref)
                        sources.append("reviewed-override")
                        notes.append(exception["note"])
                        audit["formExceptions"].append({"ref": word_ref, **exception})
                    gloss = clean_gloss(row["gloss"])
                    status = "source-aligned" if gloss else "unavailable"
                    source_ref = row["ref"]
                    if not gloss:
                        stats["maculaGlossMissing"] += 1
                        if row["gloss"].strip():
                            stats["maculaPlaceholdersRejected"] += 1
                        gloss = grammatical_marker(row)
                        if gloss:
                            status = "reviewed"
                            if "reviewed-override" not in sources:
                                sources.append("reviewed-override")
                            notes.append("The source leaves this article untranslated. Its verified article morphology is shown as a grammatical aid, not an added English translation word.")
                            audit["grammaticalMarkers"].append({"ref": word_ref, "text": token["text"], "sourceMorph": row["morph"], "rule": "article-marker-v1"})
                            stats["reviewedArticleMarkers"] += 1
                        else:
                            gloss, step_ref = fallback_gloss(token, row, tokens, step.get(ref, []))
                            if gloss:
                                sources.append("step-tagnt")
                                source_ref = step_ref
                                status = "source-aligned"
                                audit["glossFallbacks"].append({"ref": word_ref, "sourceRef": step_ref, "text": token["text"], "gloss": gloss})
                    if word_ref in gloss_overrides:
                        override = gloss_overrides[word_ref]
                        if nfc(override["original"]) != nfc(token["text"]):
                            raise ValueError(f"Gloss override word changed at {word_ref}")
                        used_glosses.add(word_ref)
                        gloss, status = override["gloss"], "reviewed"
                        notes.append(override["note"])
                        if "reviewed-override" not in sources:
                            sources.append("reviewed-override")
                    if not gloss:
                        audit["unavailableGlosses"].append({"ref": word_ref, "text": token["text"], "lemma": row["lemma"], "grammar": row["morph"]})
                        notes.append("A literal word aid has not yet been verified for this occurrence.")
                    pron = pronunciation(token["text"])
                    if pron["status"] == "pronunciation-unconfirmed":
                        audit["unconfirmedPronunciations"].append({"ref": word_ref, "text": token["text"], "note": pron["note"]})
                    aid = {"gloss": gloss, "glossStatus": status, "lemma": row["lemma"], "grammar": grammar_label(row),
                           "sources": sources, "sourceRef": source_ref, "pronunciation": pron}
                    if notes:
                        aid["notes"] = notes
                    chapter_aids[f"{verse}:{token['sourceIndex']}"] = aid
                    stats["words"] += 1
                    stats[f"gloss:{status}"] += 1
                    stats[f"pronunciation:{pron['status']}"] += 1
                    if len(pron["stressed"]) > 1:
                        stats["multipleWrittenAccents"] += 1
                    if not pron["stressed"]:
                        stats["withoutWrittenAccent"] += 1
                    book_count += 1
            data["chapters"][chapter["id"]] = chapter_aids
        outputs[ROOT / "public/aids" / f"{book_id}.json"] = encoded(data)
        audit["books"].append({"id": book_id, "chapters": len(chapter_list), "words": book_count})
    if seen_refs != set(macula):
        raise ValueError("Source verse inventory differs from app verse inventory")
    if used_forms != set(forms) or used_glosses != set(gloss_overrides):
        raise ValueError("Unused reviewed exceptions: source or app corpus has drifted")
    audit["counts"] = dict(sorted(stats.items()))
    audit["sourceVerses"] = len(macula)
    audit["policy"] = "Exact verse/index alignment; punctuation ignored; 25 reviewed surface differences. A missing/placeholder gloss whose class=det, lemma=ὁ, and morph=T-* is a reviewed grammatical marker '(article: the)', never claimed as a contextual translation. STEP fallback requires unique same-accented-form and lemma in the same verse. Other missing meanings stay unavailable; no dictionary or generated contextual-gloss fallback. Source original text and accents remain unchanged."
    outputs[ROOT / "sources/aids/greek-audit.json"] = (json.dumps(audit, ensure_ascii=False, indent=2) + "\n").encode()
    for path, content in outputs.items():
        if check:
            if not path.exists() or path.read_bytes() != content:
                raise ValueError(f"Generated output is stale: {path.relative_to(ROOT)}")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
    return audit


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify outputs without writing")
    args = parser.parse_args()
    audit = build(args.check)
    print(json.dumps({"mode": "verified" if args.check else "generated", "books": len(audit["books"]),
                      "verses": audit["sourceVerses"], "counts": audit["counts"]}, indent=2))


if __name__ == "__main__":
    main()
