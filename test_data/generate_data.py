import os
import json

if __name__ == "__main__":
    titles = ["Paatin nappaama", "Vonkale verkossa", "Mertaan jäänyt"]
    with open("test_data/urls.txt", "r") as fp:
        urls = list(filter(bool, map(lambda x: x.strip(), fp.readlines())))
    assert len(titles) * 2 == len(urls), f"expected {len(titles) * 2} URLs in urls.txt but found {len(urls)}"
    # Generate JavaScript definitions for convenience.
    with open("test_data/urls.js", "w") as fp:
        fp.write("""// This is an automatically generated file.
// The URLs are in consecutive pairs with the first being the
// normalized/canonical URL and the second needing normalization before
// hashing.

""")
        fp.write("const testUrls = [\n")
        for url in urls:
            fp.write(f'    "{url}",\n')
        fp.write("];")
    # Generate test data from predefined hashes.
    with open("test_data/hashes.txt", "r") as fp:
        hashes = list(filter(bool, map(lambda x: x.strip(), fp.readlines())))
    data = {}
    for i in range(0, len(hashes), 2):
        canonical_hash =  hashes[i]
        canonical = {
            "title": titles[i % len(titles)],
            "reason": None,
            "labels": [],
        }
        data[canonical_hash] = canonical
        noncanonical = {
            "canonical": canonical_hash,
        }
        noncanonical_hash = hashes[i + 1]
        data[noncanonical_hash] = noncanonical
    with open("test_data/data.json", "w") as fp:
        json.dump(data, fp, indent=2)

