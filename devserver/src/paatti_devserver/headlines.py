"""Headline pairs: a clickbait original and its neutral rewrite, with slots for invented names.

People are a Faker first name and a surname made of syllables, and companies use the same surnames. Faker's
surname lists include real public figures, and a fake clickbait about a real person can defame them.
"""

from dataclasses import dataclass
from random import Random

from faker import Faker

SECTIONS = ("news", "politics", "world", "sport", "showbiz", "money", "health", "tech")

SYLLABLES = (
    "mar", "vel", "tor", "ka", "lin", "dro", "sen", "bra", "quo", "zan", "fel", "gast", "hol", "rin", "pe", "sta",
    "nor", "vik", "ul", "ber", "mo", "thal", "ess", "kor", "wyn", "da", "lu", "gri", "ost", "an",
)
COMPANY_SUFFIXES = ("Group", "Holdings", "Labs", "Foods", "Motors", "Media", "Energy", "Logistics")


@dataclass(frozen=True)
class Pair:
    section: str
    original: str
    neutral: str


PAIRS = (
    Pair("news", "You won't BELIEVE what {person} found in a {city} back garden", "{person} finds a 200-year-old coin in a {city} garden"),
    Pair("news", "{city} residents FURIOUS after what the council did overnight", "{city} council closes two car parks for resurfacing"),
    Pair("news", "Is THIS the end of the {city} market? Locals fear the worst", "{city} market moves to a new site in the spring"),
    Pair("news", "Neighbours left SPEECHLESS by {person}'s bizarre new hobby", "{person} builds a model railway in a {city} allotment"),
    Pair("news", "The one thing every {city} commuter needs to know TODAY", "{city} bus timetable changes from Monday"),
    Pair("news", "{n} people saw it happen. Nobody can explain it", "{n} witnesses report a bright meteor over {city}"),
    Pair("news", "This is why your {city} water tastes different", "{city} water supplier changes treatment works for maintenance"),
    Pair("news", "Police issue URGENT warning to anyone in {city}", "{city} police advise drivers to avoid flooded roads"),
    Pair("politics", "{person} ERUPTS at rival in jaw-dropping debate moment", "{person} and rival disagree on housing policy in debate"),
    Pair("politics", "Voters STUNNED by {person}'s secret plan for {city}", "{person} proposes a new tram line for {city}"),
    Pair("politics", "What {person} said in private will make you ANGRY", "{person} criticises budget cuts at a party meeting"),
    Pair("politics", "The {n} words that could END {person}'s career", "{person} apologises for remarks about the regional budget"),
    Pair("politics", "Minister {surname} in HUMILIATING U-turn - again", "Minister {surname} withdraws proposed parking fee"),
    Pair("politics", "Everything you've been told about the {city} vote is WRONG", "{city} turnout was {n} per cent, final count shows"),
    Pair("politics", "{person}'s brutal one-word reply goes viral", "{person} declines to comment on coalition talks"),
    Pair("world", "Tourists FLEE as {city} is hit by THIS", "Heavy rain delays flights at {city} airport"),
    Pair("world", "Experts baffled: the {city} mystery nobody can solve", "Researchers study unusual cloud formation over {city}"),
    Pair("world", "Holidaymakers WARNED: do not do this in {city}", "{city} introduces a fine for swimming outside marked areas"),
    Pair("world", "Inside the {city} palace they DON'T want you to see", "{city} palace opens three rooms to visitors"),
    Pair("world", "{n} things that happened in {city} this week will SHOCK you", "{city} hosts a trade fair with {n} exhibitors"),
    Pair("world", "Why everyone is suddenly talking about {city}", "{city} named a regional capital of culture"),
    Pair("world", "{person} reveals the TERRIFYING truth about life abroad", "{person} describes moving to {city} for work"),
    Pair("sport", "{person} breaks silence - and fans can't handle it", "{person} confirms a knee injury"),
    Pair("sport", "{city} fans in MELTDOWN over shock team news", "{city} coach names an unchanged team for Saturday"),
    Pair("sport", "The moment {person} KNEW it was over", "{person} loses the final in three sets"),
    Pair("sport", "Is this the WORST decision in {city} history?", "Referee's penalty decision decides {city} derby"),
    Pair("sport", "{person}'s {n}-word message leaves teammates in TEARS", "{person} thanks teammates after the last home game"),
    Pair("sport", "What {person} did after the whistle will melt your heart", "{person} gives a signed shirt to a young fan"),
    Pair("sport", "Transfer BOMBSHELL: {person} spotted in {city}", "{person} visits {city} club for talks"),
    Pair("sport", "Rivals SLAM {person} after record-breaking run", "{person} sets a club record of {n} goals"),
    Pair("showbiz", "{person} looks UNRECOGNISABLE in new photos", "{person} attends a film premiere in {city}"),
    Pair("showbiz", "{person}'s ex finally speaks out - and it's WILD", "{person}'s former partner gives an interview about a new album"),
    Pair("showbiz", "Fans DEVASTATED by {person}'s announcement", "{person} postpones a {city} concert"),
    Pair("showbiz", "The real reason {person} left the show REVEALED", "{person} leaves the show to work on a stage play"),
    Pair("showbiz", "{person} shows off INCREDIBLE transformation", "{person} completes a {n}-kilometre charity walk"),
    Pair("showbiz", "You'll never guess who {person} was seen with in {city}", "{person} dines with a producer in {city}"),
    Pair("showbiz", "{person}'s outfit has the internet DIVIDED", "{person} wears a recycled dress at an awards event"),
    Pair("showbiz", "{person} SNUBS co-star at glitzy {city} bash", "{person} and co-star attend a {city} gala separately"),
    Pair("money", "Banks DON'T want you to know this simple trick", "Savings rates rise at three {city} banks"),
    Pair("money", "{company} customers in UPROAR over shock change", "{company} raises its monthly fee by {n} cents"),
    Pair("money", "This {n}-euro habit could make you a MILLIONAIRE", "Study compares monthly saving plans over {n} years"),
    Pair("money", "Prices are about to EXPLODE - here's what to buy now", "Inflation forecast rises to {n} per cent"),
    Pair("money", "{person} turned {n} euros into a FORTUNE. Here's how", "{person} opens a third bakery in {city}"),
    Pair("money", "Is {company} about to COLLAPSE?", "{company} reports a quarterly loss"),
    Pair("money", "Homeowners in {city} face a NIGHTMARE bill", "{city} property tax rises by {n} per cent"),
    Pair("health", "Doctors HATE this one weird trick for better sleep", "Sleep researchers recommend a regular bedtime"),
    Pair("health", "The breakfast food that's SECRETLY harming you", "Dietitians advise less added sugar at breakfast"),
    Pair("health", "{n} signs you're not drinking enough water", "Hospital in {city} publishes advice on staying hydrated"),
    Pair("health", "Scientists finally discover the TRUTH about coffee", "Study of {n} adults links moderate coffee use to no harm"),
    Pair("health", "This is what happens to your body if you walk {n} steps", "Walking {n} steps a day improves fitness, trial finds"),
    Pair("health", "The {city} clinic that's changing EVERYTHING", "{city} clinic shortens waiting times for knee surgery"),
    Pair("health", "WARNING: millions are making this mistake every morning", "Pharmacists remind patients to take medicine as prescribed"),
    Pair("tech", "Your phone is LISTENING. Here's the proof", "{company} updates its microphone permission settings"),
    Pair("tech", "{company}'s new gadget will make you throw away your laptop", "{company} launches a tablet with a detachable keyboard"),
    Pair("tech", "Hackers can do THIS to your smart fridge", "Security researchers find a flaw in some smart appliances"),
    Pair("tech", "The app everyone in {city} is secretly using", "{city} transport app passes {n} downloads"),
    Pair("tech", "{person} reveals the AI tool that does your job for you", "{person} demonstrates a scheduling assistant at a {city} fair"),
    Pair("tech", "Delete this setting NOW, experts urge", "{company} changes a default privacy setting after complaints"),
    Pair("tech", "Is this the END of passwords as we know them?", "{company} adds passkey sign-in to its service"),
    Pair("tech", "{company} just made a HUGE mistake", "{company} recalls {n} chargers over an overheating fault"),
)

EDGE_PAIRS = (
    Pair("news", "BREAKING: In a development that nobody in {city} saw coming, a committee that had met every Tuesday for {n} years without incident announced that it would, after very long deliberation and several heated exchanges about the precise wording of a single paragraph, consider meeting on Wednesdays instead, and the reaction was EXTRAORDINARY", "{city} committee moves its weekly meeting to Wednesday"),
    Pair("showbiz", "Wow.", "{person} releases a single"),
    Pair("showbiz", "🔥🔥 {person}'s 'wild' night out 😱👀", "{person} attends a birthday party in {city}"),
    Pair("tech", "<b>Exclusive</b> &amp; <script>more</script>: {company}'s next move", "{company} plans a new office in {city}"),
    Pair("world", "Jyväskylä café's crème brûlée — ÄÄNEKOSKI rivals say «non»", "Two cafés in Jyväskylä and Äänekoski compete in a pastry contest"),
    Pair("news", "   Spaces   around   and\tinside   the   headline   ", "{city} library extends opening hours"),
)


def invented_surname(rng: Random) -> str:
    return "".join(rng.choice(SYLLABLES) for _ in range(rng.randint(2, 3))).capitalize()


def fill(pair: Pair, fake: Faker, rng: Random) -> tuple[str, str]:
    """The pair's two headlines with the same invented names in both."""
    surname = invented_surname(rng)
    values = {
        "person": f"{fake.first_name()} {surname}",
        "surname": surname,
        "city": fake.city(),
        "company": f"{invented_surname(rng)} {rng.choice(COMPANY_SUFFIXES)}",
        "n": rng.randint(3, 95),
    }
    return pair.original.format(**values), pair.neutral.format(**values)
