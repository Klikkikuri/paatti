#!/usr/bin/env python3

import datetime
import os
import json
import sys

if __name__ == "__main__":
    clickbaitscale = [
        "Not Clickbait at all",
        "Slightly Clickbaity",
        "Moderately Clickbaity",
        "Very Clickbaity",
        "Extremely Clickbaity",
    ]

    test_titles = [
        "Tämä on aikas pitkä otsikko: Sellaisiakin saattaa ajoittain tulla ja toivottavasti tila riittää",
        "Tämä on ytimekäs otsikko",
        "Tämä on asiallisempi otsikko",
        "Tämä on jutun viiteryhmät huomioiden tarkempi otsikko",
        "Sanna Marin #*$@*!!",
    ]

    # Read the dump of signatures for URLs found on the page you want to use
    # for testing (e.g., iltalehti.fi) (see Paatti popup in dev mode for the
    # 'suolaa sivu' -button that generates such dump for you).
    try:
        with open("test_data/signatures.txt", "r") as fp:
            signatures = list(filter(bool, map(lambda x: x.strip(), fp.readlines())))
    except Exception as e:
        print("Failed to read the `test_data/signatures.txt` file. Have you initialized that file with suola-generated hashes of the URLs you want to use? If not, see Paatti popup in dev mode for the 'suolaa sivu' -button that generates such dump for you.", file=sys.stderr)
        sys.exit(1)

    if not signatures:
        print("The `test_data/signatures.txt` file seems to contain zero rows. Have you initialized that file with suola-generated hashes of the URLs you want to use? If not, see Paatti popup in dev mode for the 'suolaa sivu' -button that generates such dump for you.", file=sys.stderr)
        sys.exit(1)
        

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
            "labels": [
                # TODO: Replace this default.
                "com.github.klikkikuri/article-type=article"
            ],
        })
    with open("test_data/data.json", "w") as fp:
        json.dump(data, fp, indent=2)

