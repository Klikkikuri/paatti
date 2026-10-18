"""What the extension must do with a block, under the default development settings.

A port of the status decision in `processSite` (Paatti src/contentScript.js:259-315) and of
`Clickbaitiness.meetsThreshold` (src/model.js:81-87) with the default `clickbaitLevel` 2 (src/model.js:547). Under
other settings the expectations do not apply.
"""

LEVELS = (
    "Not Clickbait at all",
    "Slightly Clickbaity",
    "Moderately Clickbaity",
    "Very Clickbaity",
    "Extremely Clickbaity",
)
DEFAULT_THRESHOLD = 2

LABEL_PAYWALLED = "com.github.klikkikuri/paywalled=true"
LABEL_AI_SLOP = "com.github.klikkikuri/ai-slop=true"
LABEL_VIDEO = "com.github.klikkikuri/type=video"
LABEL_SPONSORED = "com.github.klikkikuri/sponsored=true"

# The statuses that the content script writes into data-klikkikuri-status.
CONVERTED, ORIGINAL, PAYWALLED, SKIPPED = "converted", "original", "paywalled", "skipped"
# Not a status: an expected failure passes with no status, or with SKIPPED. GAP marks a known extension gap.
XFAIL, GAP = "xfail", "gap"


def expected_status(article) -> str:
    """The status of a matched container whose link and title element were found."""
    if article is None or not article.has_entry:
        return SKIPPED
    if article.converted and article.level >= DEFAULT_THRESHOLD:
        return CONVERTED
    if not article.converted and LABEL_PAYWALLED in article.labels:
        return PAYWALLED
    return ORIGINAL


def entry_facts(article) -> str:
    """`data-expect-entry`: the level, the labels and whether a converted title exists, or `none`."""
    if article is None or not article.has_entry:
        return "none"
    labels = ",".join(label.rsplit("/", 1)[-1] for label in article.labels)
    return f"level={article.level};converted={'yes' if article.converted else 'no'};labels={labels}"
