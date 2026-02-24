# Katkıda Bulunma Rehberi

BK Video Factory projesine katkıda bulunmak için bu rehberi takip edin.

---

## ⚠️ GÜVENLİK — ÖNCELİKLİ KURALLAR

### Asla commit etmeyin
- `.dev.vars`
- `.env`, `.env.local`, `.env.*`
- `*.pem` (SSL sertifikaları)
- `credentials.json`, `secrets.json`
- Herhangi bir gerçek API anahtarı, token veya şifre

### Kontrol listesi (push öncesi)
```bash
# 1. .gitignore'da olması gereken dosyalar izleniyor mu?
git check-ignore -v .dev.vars .env   # "Ignored" çıktısı almalısınız

# 2. Yeni eklediğiniz dosyalarda credential var mı?
git diff --cached | grep -E "password|secret|token|api_key" || true

# 3. .dev.vars yanlışlıkla staged mi?
git status | grep -E "\.dev\.vars|\.env" || echo "OK"
```

### Kodda credential kullanımı
- Sabit (hardcoded) token, şifre veya API anahtarı yazmayın
- Tüm hassas veriler `env` veya `process.env` / `os.getenv` ile okunmalı
- Örnek şablon: `.dev.vars.example` — sadece boş placeholder değerler

---

## Geliştirme Akışı

1. `main`'den branch oluşturun: `git checkout -b feature/your-feature`
2. Değişiklikleri yapın, test edin
3. Commit: anlamlı mesaj (`feat: ...`, `fix: ...`)
4. Push: `git push origin feature/your-feature`
5. Pull Request açın

---

## Ortam Kurulumu

```bash
cp .dev.vars.example .dev.vars
# .dev.vars içine kendi değerlerinizi yazın (repo'ya push etmeyin)
npm install
npm run dev
```

---

## D1 Migration (Deploy)

Yeni migration eklediyseniz:
```bash
wrangler d1 migrations apply bk-video-db --remote
```

---

## İletişim

Sorularınız için issue açabilir veya [Bilge Karga](https://bilgekarga.com.tr) ile iletişime geçebilirsiniz.
