"""A Python port of the scan in processSite (Paatti src/contentScript.js:200-230), for the rule-match tests.

html5lib parses as a browser does, so nested links and misplaced blocks are restructured the same way. The browser
checks (the drift guard and the E2E tests) stay the final word on selector semantics.
"""

from bs4 import BeautifulSoup


def parse(html: str) -> BeautifulSoup:
    return BeautifulSoup(html, "html5lib")


def scan(document: BeautifulSoup, rules: list[dict]) -> list[dict]:
    found = []
    for rule in rules:
        for container in document.select(rule["container"]):
            link_rule, title_rule = rule.get("link"), rule.get("title")
            links = [container] if not link_rule or link_rule in ("self", ":scope") else container.select(link_rule)
            for link in links:
                if title_rule in ("self", ":scope"):
                    title = container
                else:
                    title = container.select_one(title_rule) if title_rule else link
                found.append({"container": container, "link": link, "title": title, "href": link.get("href")})
    return found
