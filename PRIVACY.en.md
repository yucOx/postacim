# Privacy Policy

**postacim** — end-to-end encrypted messaging · operated by yuxor.ltd
Effective: September 17, 2026

This explains what we store — and what we **cannot** see. The code is open and every claim here is verifiable against it. When we say "the server cannot see it," that is a cryptographic guarantee, not a promise.

---

## 1. What we collect / deliberately do not collect

**Stored on the server:**

- **your username (nick)** — unique, case-insensitive
- **password verification material**: your password never leaves your browser; the browser derives 32 bytes from it via Argon2id, and the server stores only the **Argon2id hash** of that material (neither the password nor a directly usable form of it is ever stored)
- **a wrapped copy of your encryption key** (key blob): your private key is sealed on your device under a key derived from your password — the server cannot open it
- **your public keys** (X25519 + Ed25519 signing key; one pair per linked device if you use multi-device) — so other users can seal channel keys to you, verify the sender attribution of your messages and compare your safety number; these are also written to the public **key ledger** (an append-only hash chain)
- **your device list** (multi-device, optional): the public key pair and linking time of each device you connect — the server knows which devices are attached to your account; it cannot see the contents of your devices (messages, keys in the clear). Revoking a device forces a key rotation (rekey)
- **a wrapped copy of your recovery key** (optional): a 12-word phrase provides a second wrap of your private key — the server never sees the words themselves
- **avatar** (optional): a 64×64 JPEG (~3–8 KB), stored unencrypted by design — it is a public profile component
- **account creation date** and session records (creation + expiry timestamps; sessions live ~7 days and are refreshed while you use the app; session tokens are stored only as SHA-256 hashes)
- **messages**: only the encrypted envelope (nonce + ciphertext), sender id, timestamp and size — content is never available in readable form
- **disappearing-message timer** (optional): the per-message TTL (`expires_at`) is **visible metadata** to the server — it knows the lifetime, never the content. Lifecycle: expired messages are tombstoned on the server (nonce/ciphertext wiped) and clients stop rendering them once expired; access + lifetime limiting is the combination of these two
- **your social graph**: which communities/channels you belong to, whom you DM, friendships, invites, roles
- **community / channel / group names** (unencrypted)
- **voice calls / conferences**: who joined, which channel, when. Call audio/video is end-to-end encrypted (SFrame); the media server (LiveKit, self-hosted) relays encrypted media and sees participation, not content

**Deliberately not collected:**

- email address, phone number — **neither is asked for, neither is stored**
- your contact list / address book
- browser/hardware fingerprints, device make/model — not collected (except the **public-key** list of your linked devices — disclosed above)
- analytics, advertising, tracking cookies, third-party statistics
- location
- **read receipts**: they never leave your device (stored in your browser, never sent to the server)

**Cookies:** a single session cookie (httpOnly, SameSite=Strict) — required to log in, used for nothing else. Also kept locally in your browser: read markers, messages you hid for yourself, pinned keys. These stay on your device.

---

## 2. Encryption: what the server can and cannot see

**Cannot see:**

- message, DM and group content (XChaCha20-Poly1305; keys exist only on participants' devices)
- your private key, your password, your recovery phrase
- voice/video call content
- channel/DM keys in the clear (only per-user wrapped copies are stored)

**Can see (metadata):**

- who wrote to whom, when, how many messages, at what size
- who is friends with whom, who is in which room, who is online or in a call
- your account creation date, last activity time
- from this, your social graph and behavioral patterns can be inferred — we say this plainly

**Dummy traffic:** a logged-in client POSTs a meaningless 32 B–4 KiB blob at random 1–10 minute intervals (/api/noise); the server does not store it and only returns 204 — the purpose is to keep your message-send timing from being distinguishable on its own.

**Safety number:** every user's key fingerprint can be compared from their profile. If the server tries to substitute a key (account takeover), a **red warning** appears. We recommend verifying safety numbers out-of-band.

**The web limitation:** the client code is served by this server; the operator could in theory serve modified client code (a limitation shared by every web-based E2EE app). The safety-number feature exists precisely to mitigate that risk.

---

## 3. Logs

- **Application log**: request method, path, status code and duration are recorded. **Message content is never logged** (request bodies are not logged). The IP in the app log is only the internal reverse-proxy address — client IPs are not written there.
- **Web server (nginx) access log**: on by default — client IP, user agent, timestamp and requested path appear there. The operator may disable it; if it is off, this page says so.
- On pre-auth endpoints, the client IP is kept **in memory only** for rate limiting — it is never persisted.
- If Cloudflare Turnstile is enabled (operator's choice), verification traffic goes to Cloudflare; when it is off, no third party receives anything.

---

## 4. Account deletion — immediate and permanent

Profile → "delete my account permanently". One click:

- your account, **every message you wrote** (all channels/DMs/groups), all your DMs, groups you created and communities you owned, your keys, avatar and all sessions are deleted **immediately and permanently**
- your recovery phrase — your only recovery path — **cannot restore a deleted account**

**Recovery:** if you forget your password, your account can be restored only with your saved 12-word recovery phrase — there is no email or phone. **If you lose both the password and the phrase, access is permanently gone; nobody can restore it.** That is not a defect; it is the design.

---

## 5. Legal requests

If compelled by law, we disclose **only what we technically hold**: the username, hashed password-verification material, account timestamps, membership/metadata and logs. **We cannot decrypt message content under any circumstances** — we hold no key capable of it, and none is stored.

---

## 6. Nature of service; limitation of liability

The service is provided **"as is"**: no warranty of availability, freedom from data loss, or fitness for a particular purpose. The operator is not liable for indirect damages arising from misuse, outages or data loss, or from your use of the service. End-to-end encryption cannot stop someone from screenshotting or copying a message.

---

## 7. Age requirement

The service is for people **16 years and older**. If you are under 16, do not create an account (aligned with the child-data processing threshold in KVKK, the Turkish data protection law).

---

## 8. Contact

Questions, deletion/data requests, complaints: **postacim@yuxor.ltd**

---

## 9. Changes to this policy

This policy is versioned and kept in the public repository. Material changes are announced in the app; the updated text is published here with a new effective date.