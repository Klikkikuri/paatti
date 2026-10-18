"""Headline pairs: an original and its neutral rewrite, with slots for invented names.

The level of a pair is the clickbait level of its original, graded by the Klikkikuri headline guide. A pair keeps
its level in every article that uses it.

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
    level: int
    original: str
    neutral: str


PAIRS = (
    Pair("news", 0, "{city} library extends its weekend opening hours", "{city} library opens on Sundays from next month"),
    Pair("politics", 0, "{city} council approves budget for new school", "{city} council approves funding for a new primary school"),
    Pair("world", 0, "Heavy snow closes roads around {city}", "Heavy snow closes main roads around {city}"),
    Pair("sport", 0, "{person} wins {city} marathon", "{person} wins the {city} marathon"),
    Pair("money", 0, "{company} cuts {n} jobs at {city} factory", "{company} cuts {n} jobs at its {city} factory"),
    Pair("health", 0, "{city} hospital opens new maternity ward", "{city} hospital opens a maternity ward with {n} beds"),
    Pair("news", 1, "{city} ferry strike: what it means for your commute", "Ferry workers' strike in {city} cancels morning crossings"),
    Pair("politics", 1, "Councillor {person} quits after bitter budget row", "Councillor {person} resigns after a dispute over the budget"),
    Pair("sport", 1, "{person} stuns favourite to reach {city} semi-final", "{person} beats the top seed to reach the {city} semi-final"),
    Pair("money", 1, "{company} shares tumble after profit warning", "{company} shares fall after it lowers its profit forecast"),
    Pair("tech", 1, "{company} finally fixes its battery bug", "{company} releases an update for a battery fault"),
    Pair("showbiz", 1, "{person} lands dream role in {city} stage show", "{person} joins the cast of a {city} stage show"),
    Pair("news", 2, "You won't BELIEVE what {person} found in a {city} back garden", "{person} finds a 200-year-old coin in a {city} garden"),
    Pair("news", 3, "{city} residents FURIOUS after what the council did overnight", "{city} council closes two car parks for resurfacing"),
    Pair("news", 3, "Is THIS the end of the {city} market? Locals fear the worst", "{city} council moves the market to a new site in the spring"),
    Pair("news", 3, "Neighbours left SPEECHLESS by {person}'s bizarre new hobby", "{person} builds a model railway in a {city} allotment"),
    Pair("news", 2, "The one thing every {city} commuter needs to know TODAY", "{city} transport authority changes the bus timetable from Monday"),
    Pair("news", 3, "{n} people saw it happen. Nobody can explain it", "{n} witnesses report a bright meteor over {city}"),
    Pair("news", 2, "This is why your {city} water tastes different", "{city} water supplier changes treatment works for maintenance"),
    Pair("news", 2, "Police issue URGENT warning to anyone in {city}", "{city} police advise drivers to avoid flooded roads"),
    Pair("politics", 3, "{person} ERUPTS at rival in jaw-dropping debate moment", "Mayoral candidate {person} and rival disagree on housing policy in debate"),
    Pair("politics", 3, "Voters STUNNED by {person}'s secret plan for {city}", "Councillor {person} proposes a new tram line for {city}"),
    Pair("politics", 2, "What {person} said in private will make you ANGRY", "Councillor {person} criticises budget cuts at a party meeting"),
    Pair("politics", 3, "The {n} words that could END {person}'s career", "Regional councillor {person} apologises for remarks about the budget"),
    Pair("politics", 2, "Minister {surname} in HUMILIATING U-turn - again", "Minister {surname} withdraws proposed parking fee"),
    Pair("politics", 4, "Everything you've been told about the {city} vote is WRONG", "Final count puts {city} turnout at {n} per cent"),
    Pair("politics", 3, "{person}'s brutal one-word reply goes viral", "Party leader {person} declines to comment on coalition talks"),
    Pair("world", 3, "Tourists FLEE as {city} is hit by THIS", "Heavy rain delays flights at {city} airport"),
    Pair("world", 2, "Experts baffled: the {city} mystery nobody can solve", "Researchers study unusual cloud formation over {city}"),
    Pair("world", 2, "Holidaymakers WARNED: do not do this in {city}", "{city} introduces a fine for swimming outside marked areas"),
    Pair("world", 4, "Inside the {city} palace they DON'T want you to see", "{city} palace opens three rooms to visitors"),
    Pair("world", 3, "{n} things that happened in {city} this week will SHOCK you", "{city} hosts a trade fair with {n} exhibitors"),
    Pair("world", 2, "Why everyone is suddenly talking about {city}", "Culture ministry names {city} a regional capital of culture"),
    Pair("world", 3, "{person} reveals the TERRIFYING truth about life abroad", "{person} describes moving to {city} for work"),
    Pair("sport", 2, "{person} breaks silence - and fans can't handle it", "{person} confirms a knee injury"),
    Pair("sport", 4, "{city} fans in MELTDOWN over shock team news", "{city} coach names an unchanged team for Saturday"),
    Pair("sport", 2, "The moment {person} KNEW it was over", "{person} loses the final in three sets"),
    Pair("sport", 2, "Is this the WORST decision in {city} history?", "Referee's penalty decision decides {city} derby"),
    Pair("sport", 2, "{person}'s {n}-word message leaves teammates in TEARS", "{person} thanks teammates after the last home game"),
    Pair("sport", 2, "What {person} did after the whistle will melt your heart", "{person} gives a signed shirt to a young fan"),
    Pair("sport", 2, "Transfer BOMBSHELL: {person} spotted in {city}", "{person} visits {city} club for talks"),
    Pair("sport", 3, "Rivals SLAM {person} after record-breaking run", "{person} sets a club record of {n} goals"),
    Pair("showbiz", 3, "{person} looks UNRECOGNISABLE in new photos", "{person} attends a film premiere in {city}"),
    Pair("showbiz", 3, "{person}'s ex finally speaks out - and it's WILD", "{person}'s former partner gives an interview about a new album"),
    Pair("showbiz", 2, "Fans DEVASTATED by {person}'s announcement", "{person} postpones a {city} concert"),
    Pair("showbiz", 2, "The real reason {person} left the show REVEALED", "{person} leaves the show to work on a stage play"),
    Pair("showbiz", 3, "{person} shows off INCREDIBLE transformation", "{person} completes a {n}-kilometre charity walk"),
    Pair("showbiz", 2, "You'll never guess who {person} was seen with in {city}", "{person} dines with a producer in {city}"),
    Pair("showbiz", 2, "{person}'s outfit has the internet DIVIDED", "{person} wears a recycled dress at an awards event"),
    Pair("showbiz", 3, "{person} SNUBS co-star at glitzy {city} bash", "{person} and co-star attend a {city} gala separately"),
    Pair("money", 4, "Banks DON'T want you to know this simple trick", "Three {city} banks raise their savings rates"),
    Pair("money", 3, "{company} customers in UPROAR over shock change", "{company} raises its monthly fee by {n} cents"),
    Pair("money", 3, "This {n}-euro habit could make you a MILLIONAIRE", "Study compares monthly saving plans over {n} years"),
    Pair("money", 4, "Prices are about to EXPLODE - here's what to buy now", "Central bank raises its inflation forecast to {n} per cent"),
    Pair("money", 3, "{person} turned {n} euros into a FORTUNE. Here's how", "{person} opens a third bakery in {city}"),
    Pair("money", 3, "Is {company} about to COLLAPSE?", "{company} reports a quarterly loss"),
    Pair("money", 2, "Homeowners in {city} face a NIGHTMARE bill", "{city} council raises property tax by {n} per cent"),
    Pair("health", 4, "Doctors HATE this one weird trick for better sleep", "Sleep researchers recommend a regular bedtime"),
    Pair("health", 2, "The breakfast food that's SECRETLY harming you", "Dietitians advise less added sugar at breakfast"),
    Pair("health", 1, "{n} signs you're not drinking enough water", "Hospital in {city} publishes advice on staying hydrated"),
    Pair("health", 2, "Scientists finally discover the TRUTH about coffee", "Study of {n} adults finds no harm from moderate coffee use"),
    Pair("health", 2, "This is what happens to your body if you walk {n} steps", "Walking {n} steps a day improves fitness, trial finds"),
    Pair("health", 2, "The {city} clinic that's changing EVERYTHING", "{city} clinic shortens waiting times for knee surgery"),
    Pair("health", 3, "WARNING: millions are making this mistake every morning", "Pharmacists remind patients to take medicine as prescribed"),
    Pair("tech", 4, "Your phone is LISTENING. Here's the proof", "{company} updates its microphone permission settings"),
    Pair("tech", 2, "{company}'s new gadget will make you throw away your laptop", "{company} launches a tablet with a detachable keyboard"),
    Pair("tech", 2, "Hackers can do THIS to your smart fridge", "Security researchers find a flaw in some smart appliances"),
    Pair("tech", 3, "The app everyone in {city} is secretly using", "{city} transport app passes {n} thousand downloads"),
    Pair("tech", 3, "{person} reveals the AI tool that does your job for you", "{person} demonstrates a scheduling assistant at a {city} fair"),
    Pair("tech", 4, "Delete this setting NOW, experts urge", "{company} changes a default privacy setting after complaints"),
    Pair("tech", 2, "Is this the END of passwords as we know them?", "{company} adds passkey sign-in to its service"),
    Pair("tech", 2, "{company} just made a HUGE mistake", "{company} recalls {n} chargers over an overheating fault"),
    Pair("showbiz", 2, "Manna Sarin's Independence Day ball gown has the nation DIVIDED", "Former Prime Minister Manna Sarin wears a dress by a {city} designer at the Independence Day reception"),
    Pair("showbiz", 4, "LEAKED VIDEO: Manna Sarin's WILD night out - watch before it's deleted", "Former Prime Minister Manna Sarin attends a friend's birthday party in {city}"),
    Pair("showbiz", 2, "Manna Sarin spotted at festival - and fans can't believe what she wore", "Former Prime Minister Manna Sarin attends a music festival in {city}"),
    Pair("showbiz", 4, "Manna Sarin's new hairstyle: experts say it means ONE thing", "Former Prime Minister Manna Sarin has a haircut"),
    Pair("showbiz", 2, "You'll never guess who Manna Sarin was seen dining with in {city}", "Former Prime Minister Manna Sarin has lunch with a former colleague in {city}"),
    Pair("showbiz", 3, "Manna Sarin's magazine cover SHOCKS the nation", "Former Prime Minister Manna Sarin gives an interview to a fashion magazine"),
    Pair("politics", 3, "Manna Sarin BREAKS SILENCE - and the internet is in MELTDOWN", "Former Prime Minister Manna Sarin comments on the government's budget proposal"),
    Pair("politics", 2, "What Manna Sarin did at the summit has everyone TALKING", "Former Prime Minister Manna Sarin speaks at a two-day summit in {city}"),
    Pair("politics", 3, "Manna Sarin's {n}-word reply leaves rivals SPEECHLESS", "Former Prime Minister Manna Sarin answers questions at a {city} panel debate"),
    Pair("politics", 3, "The REAL reason Manna Sarin left politics - finally REVEALED", "Former Prime Minister Manna Sarin starts work at an international foundation"),
    Pair("news", 4, "Manna Sarin's summer cottage SECRET exposed", "Former Prime Minister Manna Sarin spends her holiday at a cottage near {city}"),
    Pair("news", 4, "Manna Sarin's coffee order sparks FURY", "Former Prime Minister Manna Sarin buys a coffee in {city}"),
    Pair("news", 4, "Is Manna Sarin planning a COMEBACK? The clues are all there", "Former Prime Minister Manna Sarin has no plans to return to politics, her office says"),
    Pair("world", 2, "Manna Sarin's {city} trip: the photos EVERYONE is sharing", "Former Prime Minister Manna Sarin gives a lecture at a university in {city}"),
    Pair("money", 3, "Manna Sarin's book deal: you won't BELIEVE the fee", "Former Prime Minister Manna Sarin signs a contract for a book about leadership"),
    Pair("news", 0, "Frost reaches {city} tonight, roads may be slippery in the morning", "Meteorologists forecast night frost and slippery roads in {city}"),
    Pair("news", 1, "Spa hotel evacuated - guests out in their bathrobes", "Fire alarm empties a spa hotel in {city}"),
    Pair("news", 1, "Maid bit into an apple - and found a royal diamond inside", "{city} museum shows a pink diamond that a maid once found in an apple"),
    Pair("news", 2, "Watch out if you live here - a serious warning for anyone driving on Monday", "{city} police warn of slippery roads on Monday morning"),
    Pair("news", 2, "Day cruise turns into a NIGHTMARE - {n} passengers stuck on board", "{n} passengers cannot leave a ferry in {city} because of a gangway fault"),
    Pair("news", 2, "Anyone can find out your home address - an expert's blunt advice", "Data protection expert explains how to restrict who sees your address"),
    Pair("news", 2, "Did you know this stock-cube TRICK? It saves you money", "Chef shows how to make vegetable stock from leftover peel"),
    Pair("politics", 2, "Analysis: {person} sucks the air out of the room - and that is a MASSIVE danger", "Analysis: Party leader {person} dominates the campaign coverage, columnist says"),
    Pair("politics", 2, "One detail stands out - have you noticed this about {person}'s posters?", "Candidate {person}'s campaign posters use the same photo as in the last election"),
    Pair("politics", 3, "Brussels plots change - a hundred thousand jobs at RISK", "Industry group says a European Commission proposal could affect {n} thousand jobs"),
    Pair("sport", 0, "{city} opens its home season with a win", "{city} volleyball team wins its first home match of the season"),
    Pair("sport", 1, "{person} wins the championship!", "{person} wins the national rally championship"),
    Pair("sport", 1, "Bitter defeat for {city}", "{city} loses at home to the league leader"),
    Pair("sport", 1, "{person}, {n}, sets an unbelievable world record: half a litre of soda gone in seconds", "{person} sets a world record for drinking half a litre of soda"),
    Pair("sport", 2, "{person} with a STUNNING performance", "{person} wins the race from tenth on the grid"),
    Pair("sport", 2, "Racing driver: Cancer", "Racing driver {person} reveals a cancer diagnosis"),
    Pair("sport", 3, "This time it went TOO FAR! The league is in turmoil", "Ice hockey league fines a {city} club for its fans' banners"),
    Pair("showbiz", 2, "SHE is the Wellness Model of the year", "{person} wins the Wellness Model of the year contest"),
    Pair("showbiz", 3, "Unprecedented scenes on the survival show - veteran's furious outburst", "{person} criticises the producers of a reality show filmed near {city}"),
    Pair("money", 1, "{company} chief's bank balance flashes up in front of the whole company", "{company} chief executive shows a bank balance by mistake during a video meeting"),
    Pair("money", 1, "Why does a loyal customer pay more?", "Consumer authority finds that insurers charge long-term customers more than new ones"),
    Pair("money", 1, "Online shopper panics after an accidental half-million bid on a match shirt", "Online shopper bids 500,000 euros on a {city} club shirt by mistake"),
    Pair("money", 1, "Couple sells their house for half a million euros and moves into a rental flat 'super-rich'", "Retired couple sells their house and moves into a rental flat in {city}"),
    Pair("money", 2, "Retire at just 45 - we listed the jobs that let you", "Pension agency lists occupations with a lower retirement age"),
    Pair("money", 2, "Social media FUMES over {company}'s makeover: 'Awful'", "{company} changes its packaging, and some customers criticise it online"),
    Pair("health", 3, "This kind of itch ALARMS specialists at once - it can be a sign of cancer", "Dermatologist lists skin symptoms that need a doctor's check"),
    Pair("tech", 2, "We tried a 30-year-old operating system - it was NOTHING like we expected", "Review: a 30-year-old operating system still runs modern office software"),
    Pair("tech", 2, "We drove a self-driving car into Europe's most feared roundabout - here's what happened", "Test: a self-driving car gets through a busy {city} roundabout with one stop"),
)

EDGE_PAIRS = (
    Pair("news", 3, "BREAKING: In a development that nobody in {city} saw coming, a committee that had met every Tuesday for {n} years without incident announced that it would, after very long deliberation and several heated exchanges about the precise wording of a single paragraph, consider meeting on Wednesdays instead, and the reaction was EXTRAORDINARY", "{city} committee moves its weekly meeting to Wednesday"),
    Pair("showbiz", 2, "Wow.", "{person} releases a single"),
    Pair("showbiz", 3, "🔥🔥 {person}'s 'wild' night out 😱👀", "{person} attends a birthday party in {city}"),
    Pair("tech", 2, "<b>Exclusive</b> &amp; <script>more</script>: {company}'s next move", "{company} plans a new office in {city}"),
    Pair("world", 3, "ÄÄNEKOSKI rivals FURIOUS over Jyväskylä café's crème brûlée — «non»!", "Two cafés in Jyväskylä and Äänekoski compete in a pastry contest"),
    Pair("news", 2, "   Spaces   around   and\tinside   the   headline   ", "{city} library extends opening hours"),
    Pair("money", 2, "Työ\u00adelämässä on ongelma: ”Työt eivät jätä aikaa työn\u00adteolle”", "Survey finds that meetings take a third of office workers' time"),
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
