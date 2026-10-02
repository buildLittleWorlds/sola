"""Golden and failure tests. Run: python3 scripts/greek-aids/test_greek_aids.py"""
from pathlib import Path
import importlib.util
import json
import unittest
import unicodedata

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("builder", ROOT / "scripts/build-greek-aids.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class PronunciationTests(unittest.TestCase):
    def assert_reading(self, greek, syllables, accents):
        value = builder.pronunciation(greek)
        self.assertEqual(value["syllables"], syllables)
        self.assertEqual(value["stressed"], accents)
        self.assertEqual(value["status"], "written-accent")

    def test_first_words_and_distinct_vowels(self):
        self.assert_reading("Βίβλος", ["Bi", "blos"], [0])
        self.assert_reading("γενέσεως", ["ge", "ne", "se", "ōs"], [1])
        self.assert_reading("Ἰησοῦ", ["I", "ē", "sou"], [2])

    def test_breathing_diphthong_diaeresis_and_subscript(self):
        self.assert_reading("οἱ", ["hoi"], [])
        self.assert_reading("Οἱ", ["Hoi"], [])
        self.assert_reading("ὑμῖν", ["hy", "min"], [1])
        self.assert_reading("Ἀχαΐᾳ", ["A", "cha", "i", "ai"], [2])
        self.assert_reading("τῷ", ["tōi"], [0])

    def test_source_moses_spelling_not_annotation_spelling(self):
        self.assert_reading("Μωσῆς", ["Mō", "sēs"], [1])
        self.assertNotEqual(builder.pronunciation("Μωσῆς")["syllables"], builder.pronunciation("Μωϋσῆς")["syllables"])

    def test_multiple_written_accents_and_elision(self):
        self.assert_reading("οἶκόν", ["oi", "kon"], [0, 1])
        self.assert_reading("πίστεώς", ["pi", "ste", "ōs"], [0, 2])
        self.assert_reading("κατʼ", ["kat’"], [])

    def test_gamma_nasal_across_syllable_boundary(self):
        self.assert_reading("ἄγγελος", ["an", "ge", "los"], [0])

    def test_unicode_equivalence_and_unknown_letter(self):
        self.assertEqual(builder.pronunciation("γενέσεως"), builder.pronunciation(unicodedata.normalize("NFD", "γενέσεως")))
        self.assertEqual(builder.pronunciation("abc")["status"], "pronunciation-unconfirmed")
        self.assertEqual(builder.pronunciation("abc")["syllables"], [])


class SourceAlignmentTests(unittest.TestCase):
    def test_fallback_rejects_repeated_and_different_forms(self):
        token = {"text": "καὶ"}
        row = {"lemma": "καί"}
        candidate = {"text": "καὶ", "lemma": "καί", "gloss": "and", "ref": "Mat.1.1#1"}
        self.assertEqual(builder.fallback_gloss(token, row, [token], [candidate]), ("and", "Mat.1.1#1"))
        self.assertEqual(builder.fallback_gloss(token, row, [token, token], [candidate]), (None, None))
        self.assertEqual(builder.fallback_gloss(token, row, [token], [candidate, candidate]), (None, None))
        self.assertEqual(builder.fallback_gloss({"text": "καί"}, row, [{"text": "καί"}], [candidate]), (None, None))

    def test_gloss_placeholders_cannot_become_aids(self):
        for value in ("", "*", "so that ~ not", "...", "…", "{unknown}", "-", "—", "–", "--", " - ",
                      "n/a", "N/A", "n.a.", "n / a", "null", "undefined", "?", "[]", "()", "///", "•"):
            self.assertIsNone(builder.clean_gloss(value))
        self.assertEqual(builder.clean_gloss("[The] book"), "[The] book")
        self.assertEqual(builder.clean_gloss("<the>"), "(the)")
        self.assertEqual(builder.clean_gloss("none"), "none")

    def test_article_marker_requires_verified_article_not_dictionary_guess(self):
        self.assertEqual(builder.grammatical_marker({"class": "det", "morph": "T-ASM", "lemma": "ὁ"}), "(article: the)")
        self.assertIsNone(builder.grammatical_marker({"class": "pron", "morph": "R-NSM", "lemma": "ὅς"}))
        self.assertIsNone(builder.grammatical_marker({"class": "ptcl", "morph": "PRT", "lemma": "ἄν"}))
        self.assertIsNone(builder.grammatical_marker({"class": "det", "morph": "T-ASM", "lemma": "ἄν"}))

    def test_matthew_genealogy_article_is_explained_not_dash(self):
        book = json.loads((ROOT / "public/aids/MAT.json").read_text())
        for token_key in ["2:2", "2:7", "2:12"]:
            article = book["chapters"]["MAT.1"][token_key]
            self.assertEqual(article["gloss"], "(article: the)")
            self.assertEqual(article["glossStatus"], "reviewed")
            self.assertIn("reviewed-override", article["sources"])
            self.assertIn("article", article["grammar"])

    def test_generated_corpus_contains_no_placeholder_glosses(self):
        index = json.loads((ROOT / "public/corpus/index.json").read_text())
        for book in index["books"]:
            if book["testament"] != "NT":
                continue
            data = json.loads((ROOT / "public/aids" / f"{book['id']}.json").read_text())
            for chapter in data["chapters"].values():
                for aid in chapter.values():
                    if aid["gloss"] is not None:
                        self.assertIsNotNone(builder.clean_gloss(aid["gloss"]))

    def test_reviewed_exceptions_and_base_id_contract(self):
        forms = json.loads((builder.SOURCES / "reviewed-form-exceptions.json").read_text())
        self.assertEqual(len(forms), 25)
        self.assertEqual(forms["JHN 8:5!5"]["original"], "Μωσῆς")
        book = json.loads((ROOT / "public/aids/JHN.json").read_text())
        index = json.loads((ROOT / "public/corpus/index.json").read_text())
        self.assertEqual(book["corpusHash"], index["contentHash"])
        moses = book["chapters"]["JHN.8"]["5:4"]
        self.assertEqual(moses["pronunciation"]["syllables"], ["Mō", "sēs"])
        self.assertIn("reviewed-override", moses["sources"])


if __name__ == "__main__":
    unittest.main()
