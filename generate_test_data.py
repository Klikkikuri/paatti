#!/usr/bin/env python3

import datetime
import os
import json
import random
import sys


ARTICLE_LABELS = {
    ("com.github.klikkikuri/article-type=article", 50),
    ("com.github.klikkikuri/paywalled=true", 15),
    ("com.github.klikkikuri/sponsored=true", 5),
    ("com.github.klikkikuri/ai-slop=true", 5)
}

if __name__ == "__main__":
    clickbaitscale = [
        "Not Clickbait at all",
        "Slightly Clickbaity",
        "Moderately Clickbaity",
        "Very Clickbaity",
        "Extremely Clickbaity",
    ]

    _fallback_titles = [
        "Tämä on aikas pitkä otsikko: Sellaisen luominen ei ole ihanteellista, mutta ajoittain voi olla vaikeuksia tiivistää juttua sopivasti ja pitää vain toivoa, ettei tule romaanin mittaista selitystä",
        "Tämä on ytimekäs otsikko",
        "Tämä on asiallisempi otsikko",
        "Tämä on jutun viiteryhmät huomioiden tarkempi otsikko",
        "Sanna Marin #*$@*!!",
    ]

    # Read the dump of signatures for URLs found on the page you want to use
    # for testing (e.g., iltalehti.fi) (see Paatti popup in dev mode for the
    # '🧂' (copy site signatures to clipboard) -button that generates such dump
    # for you).
    err_signature_links_instruction = "Have you initialized that file with suola-generated hashes of the URLs you want to use? If not, see Paatti popup in dev mode for the '🧂' (copy link signatures to clipboard) -button that generates such dump for you."
    try:
        with open("test_data/signatures.txt", "r") as fp:
            signatures = list(filter(bool, map(lambda x: x.strip(), fp.readlines())))
    except Exception as e:
        print("Failed to read the `test_data/signatures.txt` file.", err_signature_links_instruction, file=sys.stderr)
        sys.exit(1)

    if not signatures:
        print("The `test_data/signatures.txt` file seems to contain zero rows.", err_signature_links_instruction, file=sys.stderr)
        sys.exit(1)

    _words_file = "/usr/share/dict/words"
    if os.path.isfile(_words_file):
        with open(_words_file, "r", errors="replace") as _wf:
            _wordlist = [w.strip() for w in _wf if w.strip() and w.strip().isalpha()]
        def _random_title():
            length = random.randint(3, 9)
            return " ".join(random.choice(_wordlist).capitalize() for _ in range(length))
        test_titles = [_random_title() for _ in range(len(signatures))]
    else:
        test_titles = _fallback_titles

    # Generate test data from predefined signatures.
    data = {
        "status": "ok",
        "updated": str(datetime.datetime.now(datetime.timezone.utc)),
        "schema_version": "0.1.0",
        "entries": [],
    }
    for i in range(0, len(signatures)):
        updated = str(datetime.datetime.now(datetime.timezone.utc))
        sign = signatures[i]
        title = test_titles[i % len(test_titles)]
        clickbaitiness = clickbaitscale[i % len(clickbaitscale)]
        entry_labels = []
        for label, prob in sorted(ARTICLE_LABELS):
            if random.random() * 100 < prob:
                entry_labels.append(label)

        data["entries"].append({
            "updated": updated,
            "urls": [
                {
                    "labels": [
                        # TODO: Replace this default.
                        "com.github.klikkikuri/link-rel=canonical"
                    ],
                    "sign": sign,
                }
            ],
            "title": title,
            "clickbaitiness": clickbaitiness,
            "labels": entry_labels,
            "outlet": "Iltalehti",
        })
    with open("test_data/data.json", "w") as fp:
        json.dump(data, fp, indent=2)

