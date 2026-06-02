# Verifying a CelesteOps release

CelesteOps releases are **PGP-signed** for integrity and authorship. The app bundle itself is ad-hoc signed (not Apple-notarized yet), so authenticity is established by verifying the release signature below — not by macOS Gatekeeper.

Signing key:

```
whykusanagi <me@whykusanagi.xyz>
fingerprint  9404 90EF 09DA 3132 2BF7  FD83 8758 49AB 1D54 1C55
```

## Verify the download

Download the app archive, `checksums.txt`, and `checksums.txt.asc` from the same Release into one folder, then:

```bash
# 1. Import the signing key (any one source — all serve the identical key)
curl -s https://keybase.io/whykusanagi/pgp_keys.asc | gpg --import
#   or: curl -s https://github.com/whykusanagi.gpg | gpg --import
#   or: gpg --keyserver keys.openpgp.org --recv-keys 940490EF09DA31322BF7FD83875849AB1D541C55

# 2. Confirm the fingerprint matches exactly
gpg --fingerprint 940490EF09DA31322BF7FD83875849AB1D541C55
#   → 9404 90EF 09DA 3132 2BF7  FD83 8758 49AB 1D54 1C55

# 3. Verify the signature on the checksum file (authenticity)
gpg --verify checksums.txt.asc checksums.txt        # expect "Good signature"

# 4. Verify the download matches the checksum (integrity)
shasum -a 256 -c checksums.txt                       # expect "OK"
```

If step 3 says **Good signature** and step 4 says **OK**, the download is authentic and untampered.

## Launching on macOS

The app isn't Apple-notarized, so macOS quarantines it on first launch. After verifying above, either:

- Right-click `CelesteOps.app` → **Open** → **Open** (one-time), or
- Strip the quarantine attribute:
  ```bash
  xattr -dr com.apple.quarantine /Applications/CelesteOps.app
  ```

This friction is the trade-off for not enrolling in the Apple Developer Program. The in-app build-info panel shows the running build's version, channel, hash, and signing status.
