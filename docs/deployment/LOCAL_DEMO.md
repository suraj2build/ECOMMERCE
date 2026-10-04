# VANYA local demo: review on your laptop and phone

The whole application (storefront, admin console and API) runs on your own
computer, with demo data. Any phone on the same Wi-Fi can open it. Nothing is
deployed and there is no hosting cost. Paid hosting is reserved for
production (LR-010).

## What you need (once)

| | |
|---|---|
| **Node.js 24** | https://nodejs.org (the "24" release) |
| **Docker Desktop** | https://www.docker.com/products/docker-desktop/. It runs the database, cache and search engine. Start it before the demo. |
| **Git** | To download the code: https://git-scm.com |
| **Disk and memory** | About 3 GB free and 8 GB of RAM |

Get the code (once):

```
git clone https://github.com/suraj2build/ECOMMERCE.git
cd ECOMMERCE
git checkout claude/loving-fermat-cyucke
```

## Start it: one command

```
npm run demo
```

**The first run takes about 10 minutes.** It:

1. installs packages;
2. starts PostgreSQL, Redis and Meilisearch in Docker;
3. creates the demo database;
4. builds the three apps;
5. loads the demo catalogue.

Later runs take about a minute. When it is ready, it prints:

```
  On this computer   Storefront  http://localhost:3000
                     Admin       http://localhost:3001/login

  On your phone      Storefront  http://192.168.1.20:3000
  (same Wi-Fi)       Admin       http://192.168.1.20:3001/login

  Admin sign-in      admin@vanya-demo.example
                     Vanya-xxxxxxxxxxxx-Demo1!
```

The address and password are your own. They are generated on your computer
and kept in `.demo/settings.json`, which is never committed.

Keep the window open while you review. Press **Ctrl+C** to stop.

## Open it on your phone

1. **Join the same Wi-Fi.** Connect the phone to the same Wi-Fi as the
   computer: not mobile data, and not a "guest" network (guest networks
   usually block devices from seeing each other).
2. **Type the address.** Type the phone address exactly as printed,
   including `http://` and the port (`:3000` for the storefront, `:3001`
   for the admin). It is `http`, not `https`.
3. **If Chrome warns.** Chrome may say the site is "not secure", or offer to
   switch to https. Choose to continue to the site. The demo runs only on
   your own network.

### The phone can't connect?

- **Firewall.** The first time, Windows or macOS may ask whether Node.js may
  accept connections. Allow it on **private** networks.
  - Windows: Settings → Network & internet → Wi-Fi → your network → Network
    profile: **Private**. Then Windows Security → Firewall → Allow an app →
    tick Node.js for Private.
  - macOS: System Settings → Network → Firewall → Options → allow `node`.
- **Wrong address.** The computer may have several network addresses (VPN,
  Ethernet and Wi-Fi). The script lists them. Run it again with the Wi-Fi
  one, which will rebuild for that address:
  ```
  npm run demo -- --host 192.168.1.20
  ```
- **Address changed.** If the computer's Wi-Fi address changes (another
  network, or a router restart), just run `npm run demo` again. It notices
  and rebuilds.

## What to try

| | |
|---|---|
| **Storefront** | Department gateway, the Men and Women categories, a product page (colour, size, size guide), bag, checkout with **cash on delivery**, order confirmation, search, Watch & Shop, collections. |
| **Customer sign-in** | "Sign in" with any 10-digit mobile number. There is no SMS service yet, so the 6-digit code appears in the demo window. |
| **Admin** | Sign in with the printed email and password. The orders you place appear under Orders, where you can view them, cancel lines, and record the COD collection after delivery. Products, stock, collections, promotions, content and analytics are all there too. |
| **Edit and check** | Publish, unpublish, re-price a product, or edit a collection in the admin, then reload the storefront. Changes show at once. |

Demo data:

- 12 products with colours and sizes (some sizes sold out, and one
  product sold out entirely);
- two price markdowns;
- versioned size charts;
- three collections and three Watch & Shop posts;
- five serviceable PIN codes: 110001, 400001, 560001, 600001 and 700001.

The product images are generated placeholders marked "DEMO IMAGE".

## How the demo differs from the real shop

| | Demo | Production |
|---|---|---|
| Hosting | Your computer | Paid hosting, chosen at production |
| Payment | Cash on delivery only, allowed up to ₹1,00,000 so every demo product can be ordered | Razorpay online payment and COD (COD limit ₹5,000 by default) |
| Sign-in codes | Shown in the demo window | SMS vendor (LR-008, not chosen yet) |
| Shipping | Test carrier | Carrier vendor (LR-008, not chosen yet) |
| Return photos | Saved in `.demo/` on your computer | Private S3 bucket |
| Search engines | Never indexed | Indexed |

Every storefront page shows "Preview for review only · No real orders or
payments". The demo runs the production build in its preview mode
(`DEPLOYMENT_STAGE=preview`). That mode refuses live Razorpay keys, so no
real money can be taken.

## Other commands

| Command | What it does |
|---|---|
| `npm run demo` | Start, reusing the existing build and data. |
| `npm run demo:reset` | Delete the demo data and start again with a fresh catalogue. |
| `npm run demo -- --rebuild` | Rebuild the apps, e.g. after `git pull`. A new commit also triggers this automatically. |
| `docker compose -f infra/docker-compose.yml stop` | Stop the database, cache and search containers when you are done. |

**Logs:** `.demo/logs/`. Start with `api.log`, `storefront.log` and
`admin.log` if something does not load.

**Already running?** If PostgreSQL, Redis or Meilisearch already run on
the standard ports (5432, 6379, 7700), for example from local
development, the demo uses them. It keeps its data in its own
`vanya_demo` database.
