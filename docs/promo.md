# Kauppatekstit – Klikkikuri Paatti

Tämä tiedosto ei kuulu laajennuksen pakettiin. Tekstit on tarkoitettu kopioitaviksi Chrome Web Storen ja
Firefox Add-onsin kenttiin.

## Lyhyt kuvaus (Chrome Web Store, enintään 132 merkkiä)

Oikaisee suomalaisten uutissivustojen klikkiotsikot lennosta. Näet heti, mistä jutussa on kyse.

## Tiivistelmä (AMO, enintään 250 merkkiä)

Korvaa suomalaisten uutissivustojen klikkiotsikot neutraaleilla, jutun sisältöä vastaavilla versioilla.
Oikaisut haetaan laitteellesi ladatusta listasta, joten selaushistoriaasi ei seurata. Säädä taso itse. Avointa
lähdekoodia (EUPL-1.2).

## Pitkä kuvaus

Tiedä heti, mistä uutisessa on kyse – vältä turhat klikkaukset ja lue vain sinua oikeasti kiinnostavat jutut. Klikkikuri Paatti on selainlaajennus, joka säästää aikaasi ja tekee uutisten seuraamisesta jälleen mielekästä.

💡 Miksi?

Klikkiotsikko on rakennettu niin, että pelkän perusfaktan selvittämiseksi on pakko avata artikkeli. Kun jutun aihe on jo otsikossa, sinun ei tarvitse tuhlata aikaa "arvoitusartikkeleiden" avaamiseen ja niistä pettymiseen.

Laajennus tunnistaa tuetut suomalaiset uutissivustot ja oikaisee niiden klikkihakuiset otsikot automaattisesti suoraan uutisvirtaasi. Erillisiä sovelluksia ei tarvita.

⭐ Tärkeimmät ominaisuudet:

- Avaa uutissivusto normaalisti ja anna laajennuksen hoitaa loput. Klikkiotsikot vaihtuvat lennosta oikaistuihin versioihin. Huomaat laajennuksen olemassaolon vain rauhallisempana uutispäivänä ja vähentyneenä ärsytyksenä.
- Säädä taso itse. Haluatko muuttaa kaikki otsikot superkuiviksi faktoiksi, vai oikaista vain kaikkein ärsyttävimmät klikkiotsikot?
- Tekoälymerkintä kertoo, kun jutussa on tekoälyllä tuotetulle tai käännetylle tekstille tyypillisiä piirteitä. Näet heti, kannattaako juttuun käyttää aikaa, jos kirjoittaja ei itse viitsinyt sitä kirjoittaa. Merkintä on käytössä heti asennuksen jälkeen; halutessasi saat käyttöön myös videomerkinnän ja merkinnän oikaistuista otsikoista.
- Voit lähettää palautetta otsikoista suoraan laajennuksen kautta. Palautteen perusteella oikaisu arvioidaan tarvittaessa uudelleen. Palautteen antaminen on täysin vapaaehtoista.
- Toimii myös Firefox for Android -selaimessa, mikä on selainlaajennukselle harvinaista.
- Seuraa selaimesi vaaleaa tai tummaa teemaa itsestään.
- Käyttöliittymä on saatavilla suomeksi ja englanniksi.
- Laajennuksen koodi on täysin avointa ja yhteisön auditoitavissa (EUPL-1.2 -lisenssi).

📰 Tuetut sivustot:

Toimivat heti asennuksen jälkeen:

- Helsingin Sanomat (hs.fi)
- Iltalehti (iltalehti.fi)
- Yle (yle.fi)
- MTV Uutiset (mtvuutiset.fi)
- Äänekosken Kaupunkisanomat (aksa.fi)

Vaatii ensin luvan sinulta:

- Ampparit (ampparit.com). Kytke sivusto päälle asetuksista, jolloin selain kysyy sinulta luvan siihen.

Puuttuuko oma lehtesi? Voit ehdottaa uutta sivustoa GitHubissa.

⚙️ Miten se toimii?

1. Klikkikurin taustapalvelu lukee jutun ja analysoi otsikon. Työ tehdään useilla kieliteknologioilla: nimettyjen entiteettien tunnistus (NER) poimii jutun henkilöt, organisaatiot ja paikat, muut NLP-menetelmät jäsentävät tekstin, tietolähteitä käytetään taustoitukseen, ja kielimalli arvioi lopuksi, vastaako otsikko jutun sisältöä.
2. Jos otsikko luokitellaan harhaanjohtavaksi, sille luodaan kuiva mutta sisältöä vastaava kuka-mitä-missä-versio, joka lisätään ladattavaan oikaisulistaan. Käyttäjien lähettämä palaute ohjaa listan korjaamista.
3. Klikkikuri Paatti lataa oikaisulistan ajoittain laitteellesi ja korvaa tuettujen sivustojen klikkiotsikot oikaistuilla versioilla.

🔒 Yksityisyys:

Suunniteltu foliohattu päässä. Otsikoiden tunnistus tapahtuu kokonaan laitteellasi: laajennus vertaa sivun linkkejä paikallisesti tallennettuun oikaisulistaan eikä lähetä selaushistoriaasi minnekään. Laajennus ei seuraa eikä tallenna lukutottumuksiasi.

Normaalikäytössä verkkoon lähtee vain kolme asiaa:

- oikaisulistan lataus GitHubista,
- tuetun sivuston oman kuvakkeen haku kerran sivustoa kohden, asetussivun sivustolistaa varten,
- ja palautteesi, jos itse lähetät sen. Silloin mukana kulkevat kyseisen sivun osoite sekä alkuperäinen ja oikaistu otsikko.

Tarkemmat tiedot, mukaan lukien vapaaehtoinen maksullisen version jonotuslista, löydät tietosuojaselosteesta.

❌ Mitä Klikkikuri Paatti ei tee?

- Klikkikuri ei muuta uutisten sisältöä eikä sensuroi mitään. Olkoon Yle kallellaan vasemmalle, oikealle, ylös tai alaspäin – Klikkikuri ei puutu siihen. Se puuttuu ainoastaan harhaanjohtavaan otsikointiin: itse uutisteksti, kuvat ja alkuperäinen asiasisältö pysyvät täysin koskemattomina.
- Klikkikuri ei suojaa valeuutisilta eikä arvioi väitteiden totuudenmukaisuutta. Se varmistaa ainoastaan, että otsikko vastaa jutun varsinaista sisältöä.
- Klikkikuri ei tule tielle. Se ei ole uutissovellus eikä tarjoa omaa listaa uutisista, vaan luet edelleen valitsemiasi uutislähteitä normaalisti.
- Klikkikuri ei toimi Twitterissä, Facebookissa tai muilla sosiaalisen median alustoilla.
- Klikkikuri ei oikaise sivustoja, joita se ei tue.
- Klikkikuri ei oikaise urheilu-uutisten otsikoita, koska oikaisulista ei kata urheilua.

Lataa Klikkikuri Paatti ja nauti siistimmästä, rauhallisemmasta ja rehellisemmästä uutispäivästä!
