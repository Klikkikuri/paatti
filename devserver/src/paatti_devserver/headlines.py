"""Headline pairs: a clickbait original and its neutral rewrite, with slots for invented names.

People are a Faker first name and a surname made of syllables, and companies use the same surnames. Faker's
surname lists include real public figures, and a fake clickbait about a real person can defame them. The one
recurring name, Manna Sarin, is invented too: the tabloid favourite that every front page comes back to.
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
    Pair("news", "Is THIS the end of the {city} market? Locals fear the worst", "{city} council moves the market to a new site in the spring"),
    Pair("news", "Neighbours left SPEECHLESS by {person}'s bizarre new hobby", "{person} builds a model railway in a {city} allotment"),
    Pair("news", "The one thing every {city} commuter needs to know TODAY", "{city} transport authority changes the bus timetable from Monday"),
    Pair("news", "{n} people saw it happen. Nobody can explain it", "{n} witnesses report a bright meteor over {city}"),
    Pair("news", "This is why your {city} water tastes different", "{city} water supplier changes treatment works for maintenance"),
    Pair("news", "Police issue URGENT warning to anyone in {city}", "{city} police advise drivers to avoid flooded roads"),
    Pair("politics", "{person} ERUPTS at rival in jaw-dropping debate moment", "Mayoral candidate {person} and rival disagree on housing policy in debate"),
    Pair("politics", "Voters STUNNED by {person}'s secret plan for {city}", "Councillor {person} proposes a new tram line for {city}"),
    Pair("politics", "What {person} said in private will make you ANGRY", "Councillor {person} criticises budget cuts at a party meeting"),
    Pair("politics", "The {n} words that could END {person}'s career", "Regional councillor {person} apologises for remarks about the budget"),
    Pair("politics", "Minister {surname} in HUMILIATING U-turn - again", "Minister {surname} withdraws proposed parking fee"),
    Pair("politics", "Everything you've been told about the {city} vote is WRONG", "Final count puts {city} turnout at {n} per cent"),
    Pair("politics", "{person}'s brutal one-word reply goes viral", "Party leader {person} declines to comment on coalition talks"),
    Pair("world", "Tourists FLEE as {city} is hit by THIS", "Heavy rain delays flights at {city} airport"),
    Pair("world", "Experts baffled: the {city} mystery nobody can solve", "Researchers study unusual cloud formation over {city}"),
    Pair("world", "Holidaymakers WARNED: do not do this in {city}", "{city} introduces a fine for swimming outside marked areas"),
    Pair("world", "Inside the {city} palace they DON'T want you to see", "{city} palace opens three rooms to visitors"),
    Pair("world", "{n} things that happened in {city} this week will SHOCK you", "{city} hosts a trade fair with {n} exhibitors"),
    Pair("world", "Why everyone is suddenly talking about {city}", "Culture ministry names {city} a regional capital of culture"),
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
    Pair("money", "Banks DON'T want you to know this simple trick", "Three {city} banks raise their savings rates"),
    Pair("money", "{company} customers in UPROAR over shock change", "{company} raises its monthly fee by {n} cents"),
    Pair("money", "This {n}-euro habit could make you a MILLIONAIRE", "Study compares monthly saving plans over {n} years"),
    Pair("money", "Prices are about to EXPLODE - here's what to buy now", "Central bank raises its inflation forecast to {n} per cent"),
    Pair("money", "{person} turned {n} euros into a FORTUNE. Here's how", "{person} opens a third bakery in {city}"),
    Pair("money", "Is {company} about to COLLAPSE?", "{company} reports a quarterly loss"),
    Pair("money", "Homeowners in {city} face a NIGHTMARE bill", "{city} council raises property tax by {n} per cent"),
    Pair("health", "Doctors HATE this one weird trick for better sleep", "Sleep researchers recommend a regular bedtime"),
    Pair("health", "The breakfast food that's SECRETLY harming you", "Dietitians advise less added sugar at breakfast"),
    Pair("health", "{n} signs you're not drinking enough water", "Hospital in {city} publishes advice on staying hydrated"),
    Pair("health", "Scientists finally discover the TRUTH about coffee", "Study of {n} adults finds no harm from moderate coffee use"),
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
    Pair("showbiz", "Manna Sarin's Independence Day ball gown has the nation DIVIDED", "Former Prime Minister Manna Sarin wears a dress by a {city} designer at the Independence Day reception"),
    Pair("showbiz", "LEAKED VIDEO: Manna Sarin's WILD night out - watch before it's deleted", "Former Prime Minister Manna Sarin attends a friend's birthday party in {city}"),
    Pair("showbiz", "Manna Sarin spotted at festival - and fans can't believe what she wore", "Former Prime Minister Manna Sarin attends a music festival in {city}"),
    Pair("showbiz", "Manna Sarin's new hairstyle: experts say it means ONE thing", "Former Prime Minister Manna Sarin has a haircut"),
    Pair("showbiz", "You'll never guess who Manna Sarin was seen dining with in {city}", "Former Prime Minister Manna Sarin has lunch with a former colleague in {city}"),
    Pair("showbiz", "Manna Sarin's magazine cover SHOCKS the nation", "Former Prime Minister Manna Sarin gives an interview to a fashion magazine"),
    Pair("politics", "Manna Sarin BREAKS SILENCE - and the internet is in MELTDOWN", "Former Prime Minister Manna Sarin comments on the government's budget proposal"),
    Pair("politics", "What Manna Sarin did at the summit has everyone TALKING", "Former Prime Minister Manna Sarin speaks at a two-day summit in {city}"),
    Pair("politics", "Manna Sarin's {n}-word reply leaves rivals SPEECHLESS", "Former Prime Minister Manna Sarin answers questions at a {city} panel debate"),
    Pair("politics", "The REAL reason Manna Sarin left politics - finally REVEALED", "Former Prime Minister Manna Sarin starts work at an international foundation"),
    Pair("news", "Manna Sarin's summer cottage SECRET exposed", "Former Prime Minister Manna Sarin spends her holiday at a cottage near {city}"),
    Pair("news", "Manna Sarin's coffee order sparks FURY", "Former Prime Minister Manna Sarin buys a coffee in {city}"),
    Pair("news", "Is Manna Sarin planning a COMEBACK? The clues are all there", "Former Prime Minister Manna Sarin has no plans to return to politics, her office says"),
    Pair("world", "Manna Sarin's {city} trip: the photos EVERYONE is sharing", "Former Prime Minister Manna Sarin gives a lecture at a university in {city}"),
    Pair("money", "Manna Sarin's book deal: you won't BELIEVE the fee", "Former Prime Minister Manna Sarin signs a contract for a book about leadership"),
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
