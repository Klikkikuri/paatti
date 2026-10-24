# Klikkikuri – uutiset ilman klikkiotsikoita

![](assets/logo.png)

**Klikkikuri** on selainlaajennus, joka tunnistaa ja oikaisee sensaatiohakuiset uutisotsikot kun selailet verkkolehtien uutissivuja. Tarjoamme ainoana suomalaisena ratkaisuna luotettavampaa uutisointia suomalaisille uutisten kuluttajille hyödyntäen tekoälyä ja avoimen lähdekoodin teknologiaa.

*Koe uutiset luotettavimmiksi.*

- [Klikkikuri – uutiset ilman klikkiotsikoita](#klikkikuri--uutiset-ilman-klikkiotsikoita)
  - [Ominaisuudet](#ominaisuudet)
  - [Asennus](#asennus)
  - [Toiminta](#toiminta)
    - [Palvelun toimintamalli](#palvelun-toimintamalli)
    - [Yksityisyys](#yksityisyys)
  - [Maksullinen palvelu](#maksullinen-palvelu)
    - [Maksumuurien takana olevien uutisten prosessointi](#maksumuurien-takana-olevien-uutisten-prosessointi)
  - [Usein kysyttyjä kysymyksiä](#usein-kysyttyjä-kysymyksiä)
    - [Kuinka luotettava Klikkikuri on?](#kuinka-luotettava-klikkikuri-on)
    - [Näenkö alkuperäisen otsikon mistään?](#näenkö-alkuperäisen-otsikon-mistään)
    - [Miksi näen edelleen klikkiotsikoita?](#miksi-näen-edelleen-klikkiotsikoita)
    - [Voinko tehdä jotain jos oikaistu otsikko on huonompi kuin alkuperäinen?](#voinko-tehdä-jotain-jos-oikaistu-otsikko-on-huonompi-kuin-alkuperäinen)
    - [Kuinka usein uutisotsikoita päivitetään?](#kuinka-usein-uutisotsikoita-päivitetään)
    - [Mitä maksullinen tilausversio sisältää?](#mitä-maksullinen-tilausversio-sisältää)
    - [Milllä perusteella tuetut uutissivustot valitaan?](#milllä-perusteella-tuetut-uutissivustot-valitaan)
      - [Sisällyttämiskäytäntö](#sisällyttämiskäytäntö)
    - [Seuraako Klikkikuri uutisia joita luen?](#seuraako-klikkikuri-uutisia-joita-luen)
    - [Toimiiko Klikkikuri sosiaalisessa mediassa?](#toimiiko-klikkikuri-sosiaalisessa-mediassa)
    - [Voinko käyttää Klikkikuria mobiililaitteilla?](#voinko-käyttää-klikkikuria-mobiililaitteilla)
    - [Mikä on selainlaajennuksen mukana tuleva binääri?](#mikä-on-selainlaajennuksen-mukana-tuleva-binääri)
    - [Tuhoaako Klikkikuri luontoa?](#tuhoaako-klikkikuri-luontoa)
  - [Kiitokset](#kiitokset)

## Ominaisuudet

 - **Automaattinen otsikoiden oikaisu**: muokkaa klikkiotsikot vastaamaan paremmin uutisen sisältöä.
 - **Helppokäyttöisyys**: toimii useimmissa verkkoselaimissa ilman monimutkaisia asennusta.
 - **Avoin lähdekoodi**: EUPL-1.2-lisenssi[^eupl] varmistaa palvelun toiminnan läpinäkyvyyden ja estää koodin kaappaamisen suljetuksi tuotteeksi[^no-cla].
 - **Freemium-malli**: ilmainen perusversio, maksullinen korjaus paywall-sivustoille.

## Asennus

Selainlaajennus on saavilla [Google Chromelle](https://chromewebstore.google.com/detail/klikkikuri-paatti/jalegaigmgljhnaakmbbaajooffgcbgc?hl=fi) ja [Mozilla Firefoxille](https://addons.mozilla.org/fi-FI/firefox/addon/klikkikuri/). Jotkin chrome-pohjaiset selaimet kuten Brave voivat myös ladata lajennuksen, mutta emme voi taata laajennuksen toimivuutta niissä. Laajennus on saatavilla myös suoraan [GitHubista *Klikkikuri/paatti*](https://github.com/Klikkikuri/paatti/releases).

Lataa laajennus Google Chromelle [🛍️ Chrome Web Storesta](https://chromewebstore.google.com/detail/klikkikuri-paatti/jalegaigmgljhnaakmbbaajooffgcbgc?hl=fi) tai Mozilla Firefoxille [🦊 Firefox Add-onsista](https://addons.mozilla.org/fi-FI/firefox/addon/klikkikuri/).

## Toiminta

### Palvelun toimintamalli

![](assets/modus-operandi-2024-09-29-0135.png)

Näin Klikkikuri tarkistaa uutisen sisällön ja otsikon vastaavuuden:

1. Palvelu noutaa uuden uutisen uutissivustolta​.
2. Artikkelista tunnistetaan uutiseen liittyvät sidosryhmät ja eri intressitahot​.
3. Tietämystietokannasta etsitään tietoa intressitahojen yhteyksistä uutiseen​.
4. Uutisartikkelia täydennetään tietämystietokannan tiedoilla intressitahoista​ –  tällä pyritään takaamaan uutisen parempi taustoitus ja vähentämään kielimalleille tyypillistä hallusinaatiota.
5. Kielimalli arvioi alkuperäisen otsikon sopivuutta ja ehdottaa tarvittaessa uutta otsikkoa.
6. Jos uusi otsikko on luotu, se tallennetaan otsikkotietokantaan kielimallin tarjoamien perustelujen kanssa.​
7. Tietokannasta luodaan päivitetty vedos otsikoista ja niiden tunnisteista.​ Selainlaajennus lataa tämän listan ajoittain automaattisesti.
8. Käyttäjä avaa ja lataa uutissivun normaalisti. Asennettu Klikkikurin selainlaajennus tunnistaa sivun tuetuksi uutissivustoksi, lukee ladatun otsikkolistan ja vaihtaa uutissivuston otsikot listan tunnisteiden pohjalta.​
9. Näin käyttäjä näkee uutissivuston korjatuilla otsikoilla ilman tarvetta manuaaliselle intervaatiolle.​

### Yksityisyys

Klikkikuri-laajennus ei kerää käyttäjältä tietoja muissa tilanteissa kuin:
- Käyttäjä osallistuu käyttäjätutkimukseen, jolloin kerättävä tieto on erikseen määritelty ja rajattu
- Käyttäjä ilmoittaa virheellisestä otsikosta
- Käyttäjä ilmoittautuu maksulliseen palveluun

Käyttämällä paikallista vedosta tietokannasta laajennuksen ei tarvitse myöskään lähettää kutsuja ulkoiseen palveluun, jolloin palvelu ei voi seurata käyttäjien uutissivusto-käyttäytymistä.

Lue lisää Klikkikuri Paatti "Privacy Policy" -dokumentista: [https://github.com/Klikkikuri/paatti/blob/main/docs/PRIVACY_POLICY.md](https://github.com/Klikkikuri/paatti/blob/main/docs/PRIVACY_POLICY.md).

## Maksullinen palvelu

> [!NOTE] Saatavuus
> Maksullinen palvelu ei ole vielä saatavilla.

Klikkikuri tarjoaa maksullisena lisäpalveluna listan maksumuurin takana olevista uutisista. Muuta toiminnallisuutta ei ole piilotettu maksumuurin taakse. Maksulla rahoitetaan pääsy maksullisiin uutisiin, sekä kielimallien suorittaminen.

### Maksumuurien takana olevien uutisten prosessointi

Vaikka maksumuurien takana olevien uutisten prosessoinnin voi suorittaa myös itse-pystytetyllä [meri](https://github.com/Klikkikuri/meri) -instanssilla, Klikkikuri ei tue sitä. Se saattaa rikkoa uutissivustojen käyttöehtoja, sekä lähes varmasti rikkoo suomen hieman epämääräistä tekijänoikeuslakia ja sen jokseenkin mielivaltaista soveltamista. Joten tee se vain jos sinulla on lupa siihen.

Klikkikurin oma palvelu käyttää eri tekniikkaa maksumuurin takana olevien uutisten prosessointiin, joka on suunniteltu noudattamaan lain pykäliä. Tätä ei paljasteta toistaiseksi tarkemmin, mutta Klikkikuri pyrkii toimimaan lain puitteissa. Lakipykälän teknisen määritelmän tuntevat voiva arvata kuitenkin miten ja millä kikalla maksumuurin takana olevien uutisten prosessointi on toteutettu.

## Usein kysyttyjä kysymyksiä

### Kuinka luotettava Klikkikuri on?

Klikkikuri pyrkii luotettavuuteen avoimella lähdekoodilla ja läpinäkyvällä toiminnalla. Tällöin toiminnan luotettavuuden voi ulkoinen taho arvioida ja varmistaa. Kielimallia ohjaavat semi-selkokieliset ohjeet ovat luettavissa [`meri/src/prompts`](https://github.com/Klikkikuri/meri/tree/main/src/meri/prompts) -kansiossa.

Kielimalleille tyypillistä hallusinointia vastaan Klikkikuri käyttää toistaiseksi parhaaksi tiedettyä keinoa, jossa uutisen lisäksi kielimallille kerrotaan ajantasaisia ydinseikkoja taustoittavista tekijöistä[^paper-llm-hallucination][^paper-llm-hal-study].

Kielimalleihin rakennettuja sensuuri-, puolueellisuus-, ja ennakkoasenteita vastaan välttämiseksi klikkikuri pyrkii käyttämään vähintään kolmea eri kielimallia eri kulttuureista. Esimerkiksi Amerikkalainen ChatGPT on haluton käsitellä laittomuuksiin[^chatgpt-policy] tai seksuaalisuuteen liittyviä aiheita[^chatgpt-no-nsfw], Kiinalainen Deepseek haluton sanomaan mitään kriittistä Kiinan toimista[^deepseek-tian][^deepseek-cn-prop], tai Elon Muskin omistamaan Grokiin on sisäänrakennettu käsky olla "Anti-woke"[^xai-antiwoke][^xai-rebel].

### Näenkö alkuperäisen otsikon mistään?

Klikkikuri muuttaa ainoastaan otsikot linkeissä, kuten etusivulla jossa tyypillisesti on ainoastaan otsikko sekä mahdollisesti ingressi. Varsinaisen artikkelin otsikko jätetään vastamaan alkuperäistä.

Laajennuksen voi ottaa myös pois käytöstä sivustokohtaisesti, sekä asetuksista määritellä kuinka paljon otsikoiden tulee olla harhaanjohtava ennen kuin ne muutetaan.

### Miksi näen edelleen klikkiotsikoita?

Selainlaajennus käyttää staattista listaa yksityisyyden suojaamiseksi. Staattisuuden vuoksi lista päivittyy viiveellä, eikä aina sisällä uusimpia otsikoita.

Ilmaisversio ei myöskään pysty muuttamaan maksumuurien takana olevia uutisia, joten timanttijutut / plus-artikkelit yms. jäävät alkuperäiseksi.

Rajallisten resurssien vuoksi vain yleisimmät ja toivotuimmat sivustot ovat tuettuja. Myöskään sivustot jotka eivät pyri _totuudenmukaiseen_ uutisointiin – kuten puoluelehdet – eivät tule olemaan tuettuja (kts. [Milllä perusteella tuetut uutissivustot valitaan?](#milllä-perusteella-tuetut-uutissivustot-valitaan)).

Selainlaajennus ei myöskään pyri muuttamaan kaikkia otsikoita. Oletuksena pieni puutteellisuus otsikoissa sallitaan. Tätä voi käyttäjä itse säätää, ja halutessaan korvata vaikkapa kaikki tekoälyn tekemällä versiolla, jos tykkää kuivasta otsikoinnista.

On myös mahdollista ettei uutista ja otsikkoa ole arvioitu oikein, tai muodostettu otsikko on vain huono. Tällöin virheellinen otsikko voidaan raportoida käyttäjän toimesta, ja raportoituja otsikoita käytetään parantamaan kielimallin tuottamien otsikoiden laatua.

### Voinko tehdä jotain jos oikaistu otsikko on huonompi kuin alkuperäinen?

Laajennus tarjoaa mahdollisuuden raportoida huonot otsikko-oikaisut. Käyttäjät voivat myös halutessaan ehdottaa parempaa otsikkoa. Raportoitujen otsikoiden oikaisua saatetaan yrittää uudelleen, jos uutinen on edelleen ajankohtainen.

### Kuinka usein uutisotsikoita päivitetään?

Selainlaajennus päivittää listan noin 20min välein. Tämän lisäksi palvelu pyrkii arvioimaan uutisten julkaisun tiheyttä, jolloin esimerkiksi yöllä lista päivittyy hitaammin päivää hitaammin. Tämän vuoksi on mahdollista nähdä useampia oikaisemattomia otsikoita päivällä, mutta yksittäisiä pidempään yöllä.

### Mitä maksullinen tilausversio sisältää?

Maksullinen versio sisältää oikaisun myös maksumuurin takana oleviin uutisiin. Maksulla mahdollistetaan Klikkikuri-palvelun pääsy maksullisiin uutisiin.

Lisäksi maksullisen palvelun käyttäjät voivat vaikuttaa suoraan sisällytettävien uutissivustojen listaan äänestämällä.

### Milllä perusteella tuetut uutissivustot valitaan?

Jotta Klikkikuri-palvelu tukee uutissivua, sille tarvitaan riittävästi kysyntää käyttäjäkunnan keskuudessa. Tämän mittaaminen on tosin hankalaa, sillä Klikkikuri ei kerää mitään käyttäjätietoja. Jossain määrin mennään täten äänekkäiden terrorilla.

Klikkikuri myös erottaa uutislähteet ja uutissivustot toisistaan. *uutislähde* määritellään tässä yhteydessä uutisten tuottajaksi, jonka tukeminen vaatii myös uutisten prosessointiin tuen. *Uutissivusto* taas määritellään yksittäiseksi verkkosivustoksi, joka julkaisee uutisia tai linkkejä. *Uutissivuston* tukeminen vaatii lähinnä selainlaajennuksen tuen.

#### Sisällyttämiskäytäntö

1. Uutislähteen tulee **pyrkiä ensisijaiseti fakta-pohjaiseen journalismiin**. Uutislähteet jotka ovat lähtökohtaisesti mielide-, tai arvo-pohjaisia, eivät ole tuettuja. Otsikoiden muuttaminen toisi tällaisilla sivustoilla valheellista uskottavuutta. Klikkikurin toimii klikkiotsikoiden oikaisuun, ei faktantarkistimena.
2. Uutislähteelle tulee olla **riittävästi käyttäjien kysyntää**. Klikkikuri ei omaa keinoa seurata mitä uutislähteitä käyttäjät lukevat, joten uutislähteiden tuki perustuu lukijakunnan äänekkyyteen. Uutislähteet joita käyttäjäkunta ei seuraa, vie resursseja ja voi estää seuratumpien uutislähteiden tukemisen.
3. Selkeä indeksi / etusivu. Klikkikuri **prosessoi ainoastaan etusivun, kategoriasivujen ja linkkisyötteiden sisältöä**.

### Seuraako Klikkikuri uutisia joita luen?

**Ei**. Katso [Yksityisyys](#yksityisyys).

### Toimiiko Klikkikuri sosiaalisessa mediassa?

**Ei**. Joitain aggregaattisivuja kuten _Ampparit_ saatetaan tukea tulevaisuudessa. Sosiaalisen median alustat kuten Facebook ja Twitter lähtökohtaisesti kohdistaa käyttäjilleen "mieluisaa" sisältöä, olkoonkin se monesti erittäin klikkiotsikkomaista – tunnelatautunutta ja "ulkopuolisille" vihamielistä [^paper-fb-polarization][^paper-some-encage]. Sivustot kuten Reddit taas nojaa klikkiotsikoissa moderaattorien toimintaan.

### Voinko käyttää Klikkikuria mobiililaitteilla?

Ainoastaan jotkin mobiiliselaimet ovat selainlaajennuksen tukemia. Myöskään monet mobiiliselaimet eivät tue laajennuksia. Sivustojen omat sovellukset eivät ole tuettuja – poikkeuksena [PWA](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/What_is_a_progressive_web_app) -sovellukset jos ne ovat asennettu tuetusta selaimesta.

### Mikä on selainlaajennuksen mukana tuleva binääri?

Selainlaajunneksen mukana tule binääri on [WebAssembly modulli joka vastaa otsikoiden tunnistamisesta](https://github.com/Klikkikuri/suola). Moduuli on binääri, jotta sekä taustapuolen prosessointi, että selainlaajennus voivat käyttää samaa koodia eroavaisuuksien välttämiseksi. Selainlaajennuksen mukana tuleva moduuli on täysin sama mikä on saatavilla githubista, ja varmistettavissa että binääri vastaa lähdekoodia joka on ollut githubissa sen kääntöhetkellä (`gh attestation verify --repo Klikkikuri/suola build/js.wasm`).

### Tuhoaako Klikkikuri luontoa?

Ikävä kyllä[^paper-greenai]. Vaikutusten vähentämiseksi Klikkikuri-palvelu pyrkii käyttämään kielimalleja palveluilla jotka käyttävät uusiutuvaa energiaa. Lisäksi Klikkikurin toiminnan luoteesta johtuen – joka on pohjimmiltaan tiivistystehtävä – monivaiheiseen ja kattavaan "ajatteluun" ei ole tarvetta[^paper-llm-sum][^paper-sum-bench][^paper-news-sum], ja malleina voidaan käyttää pienempiä ja vähemmän energiaa vieviä malleja.

## Kiitokset

Klikkikurin kehitys on mahdollista kiitos [Jyväskylän Yliopiston](https://www.jyu.fi), [Jyväskylän kaupungin](https://www.jyvaskyla.fi) sekä [Jyväskylän Ammattikorkeakoulun](https://www.jamk.fi) omistaman [Jyväskylän Yritystehtaan myöntämän rahoituksen](https://yritystehdas.fi/tuotekehitysrahoitus) ansiosta. Tehty ❤️ Jyväskylässä.



[^eupl]: [“EUPL-1.2.”](https://joinup.ec.europa.eu/collection/eupl/eupl-text-eupl-12) *European Union Public Licence* on EU:n virallinen avoimen lähdekoodin copyleft-lisenssi. Juridisesti se eroutuu muista lisensseistä 23 yhtäläisesti pätevän kieliversion, EU-oikeuteen sovitetun vastuu- ja tekijänoikeussääntelyn sekä sisäänrakennetun lisenssiyhteensopivuuden (Artikla 5) ansiosta.
[^no-cla]: Klikkikuri ei käytä CLA-sopimusta, joka mahdollistaisi ns. Open Core -mallin tai äkillisen muutoksen suljetuksi palveluksi. Jos haluat tehtä tästä vieläkin vaikeampaa, osallistu Klikkikurin kehitykseen ja tee pull request, niin voit varmistaa että koodin linsessimuutos muuttuu mahdollisimman kivuliaaksi.
[^chatgpt-policy]: [“Usage Policies.”](https://openai.com/policies/usage-policies/) Openai.com.
[^chatgpt-no-nsfw]: [“Model Spec (2024/05/08).”](https://cdn.openai.com/spec/model-spec-2024-05-08.html#dont-respond-with-nsfw-content) Openai.com.
[^deepseek-tian]: [“We Tried out DeepSeek. It Worked Well, until We Asked It about Tiananmen Square and Taiwan.”](https://www.theguardian.com/technology/2025/jan/28/we-tried-out-deepseek-it-works-well-until-we-asked-it-about-tiananmen-square-and-taiwan) The Guardian.
[^deepseek-cn-prop]: [“DeepSeek’s Answers Include Chinese Propaganda, Researchers Say.”](https://www.nytimes.com/2025/01/31/technology/deepseek-chinese-propaganda.html) The New York Times.
[^xai-antiwoke]: [“Inside Grok’s War on ‘Woke.’”](https://www.businessinsider.com/xai-grok-training-bias-woke-idealogy-2025-02?op=1) Business Insider.
[^xai-rebel]: [“Elon Musk Announces Grok, a ‘Rebellious’ AI With Few Guardrails.”](https://www.wired.com/story/elon-musk-announces-grok-a-rebellious-ai-without-guardrails/). Wired.
[^paper-llm-hallucination]: [“Knowledge Injection to Counter Large Language Model (LLM) Hallucination.”](https://link.springer.com/chapter/10.1007/978-3-031-43458-7_34) Lecture Notes in Computer Science, January, 182–85.
[^paper-fb-polarization]: [“Social Media, News Consumption, and Polarization: Evidence from a Field Experiment.”](https://www.aeaweb.org/articles?id=10.1257/aer.20191777) American Economic Review 111 (3): 831–70.
[^paper-some-encage]: [“Engagement, user satisfaction, and the amplification of divisive content on social media.”](https://academic.oup.com/pnasnexus/advance-article/doi/10.1093/pnasnexus/pgaf062/8052060) PNAS Nexus (2025): pgaf062.
[^paper-llm-hal-study]: [“A Comprehensive Survey of Hallucination Mitigation Techniques in Large Language Models.”](https://arxiv.org/abs/2401.01313) ArXiv.org.
[^paper-greenai]: [“Green AI: Exploring Carbon Footprints, Mitigation Strategies, and Trade Offs in Large Language Model Training.”](https://link.springer.com/article/10.1007/s44163-024-00149-w) Discover Artificial Intelligence.
[^paper-llm-sum]: [“Element-Aware Summarization with Large Language Models: Expert-Aligned Evaluation and Chain-of-Thought Method.”](https://aclanthology.org/2023.acl-long.482/) ArXiv (Cornell University)
[^paper-sum-bench]: [“Benchmarking Large Language Models for News Summarization.”](https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00632/119276/Benchmarking-Large-Language-Models-for-News) Transactions of the Association for Computational Linguistics 12 (January): 39–57.
[^paper-news-sum]: [“News Summarization and Evaluation in the Era of GPT-3.”](https://arxiv.org/abs/2209.12356) arXiv preprint.
