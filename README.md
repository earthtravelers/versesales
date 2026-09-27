# STUPIDS satış bildirimi botu

Verse'teki STUPIDS koleksiyonunun Ethereum kontratını (0x00c2…7f1b) izler.
Her yeni mint (Verse'te satış) ve her transfer (ikincil satış / cüzdana çekme) için e-posta gönderir.

## 1. Gmail uygulama şifresi al
1. Google hesabında 2 adımlı doğrulama açık olmalı.
2. https://myaccount.google.com/apppasswords → isim ver ("STUPIDS bot") → Oluştur.
3. Çıkan 16 haneli şifreyi kopyala (boşluksuz).

## 2. Railway'e kur (satış botunla aynı yöntem)
1. Bu klasörü yeni bir GitHub reposuna yükle.
2. Railway → New Project → Deploy from GitHub → bu repoyu seç.
3. Variables sekmesine `.env.example` içindeki değerleri gir
   (en az MAIL_TO, GMAIL_USER, GMAIL_APP_PASSWORD).
4. İlk çalışmada TEST_MAIL=true ise sana bir test e-postası gelir. Geldiyse TEST_MAIL'i false yap.

## Bilgisayarda denemek için
    cp .env.example .env   # değerleri doldur
    npm install
    npm start

## Notlar
- Bot başlatıldığı andan itibaren izler; geçmiş satışlar için e-posta atmaz.
  Geçmişten başlatmak istersen START_BLOCK değişkenine bir blok numarası ver.
- Transfer e-postası istemiyorsan NOTIFY_TRANSFERS=false yap (sadece yeni mintler gelir).
- Aynı blokta birden fazla satış olursa tek e-postada toplanır.
