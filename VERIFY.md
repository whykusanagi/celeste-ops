# Verifying a CelesteOps release

Each release is PGP-signed for integrity and authorship, and the app is Apple
Developer-ID codesigned and notarized so it opens without Gatekeeper warnings.

Signing key:

```
whykusanagi <me@whykusanagi.xyz>
fingerprint  9404 90EF 09DA 3132 2BF7  FD83 8758 49AB 1D54 1C55
```

## Verify the download

Download the app archive, `checksums.txt`, and `checksums.txt.asc` from the same
Release into one folder, then:

```bash
# 1. Import the signing key (any one source; all serve the identical key).
curl -s https://keybase.io/whykusanagi/pgp_keys.asc | gpg --import
#   or: curl -s https://github.com/whykusanagi.gpg | gpg --import
#   or: gpg --keyserver keys.openpgp.org --recv-keys 940490EF09DA31322BF7FD83875849AB1D541C55

# 2. Confirm the fingerprint.
gpg --fingerprint 940490EF09DA31322BF7FD83875849AB1D541C55
#   → 9404 90EF 09DA 3132 2BF7  FD83 8758 49AB 1D54 1C55

# 3. Verify the signature on the checksum file (authenticity).
gpg --verify checksums.txt.asc checksums.txt        # "Good signature"

# 4. Verify the download matches the checksum (integrity).
shasum -a 256 -c checksums.txt                       # "OK"
```

A "Good signature" in step 3 and "OK" in step 4 mean the download is authentic
and untampered.

## Confirm the app's code signature

```bash
codesign --verify --deep --strict --verbose=2 /Applications/CelesteOps.app
spctl -a -t exec -vvv /Applications/CelesteOps.app   # "accepted", "Notarized Developer ID"
```

If a build ever ships without notarization, macOS quarantines it on first launch.
Right-click the app and choose Open, or clear the quarantine flag:

```bash
xattr -dr com.apple.quarantine /Applications/CelesteOps.app
```
