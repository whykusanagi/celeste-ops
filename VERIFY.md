# Verifying a CelesteOps release

Each release ships with a **PGP-signed `checksums.txt`**. That signature is the
authenticity guarantee: it proves the download came from the maintainer and
wasn't tampered with.

Signing key:

```
whykusanagi <me@whykusanagi.xyz>
fingerprint  9404 90EF 09DA 3132 2BF7  FD83 8758 49AB 1D54 1C55
```

## Verify the download

Download the app archive, `checksums.txt`, and `checksums.txt.asc` from the same
Release into one folder, then:

```bash
# 1. Import the signing key. The repo ships it as whykusanagi.asc and it carries
#    the signing subkey the release was signed with. If you haven't cloned the
#    repo, fetch just the key first:
curl -O https://raw.githubusercontent.com/whykusanagi/celeste-ops/main/whykusanagi.asc
gpg --import whykusanagi.asc

# 2. Confirm the fingerprint, and cross-check it against an independent source:
#    the same primary fingerprint is published at https://github.com/whykusanagi.gpg
gpg --fingerprint 940490EF09DA31322BF7FD83875849AB1D541C55
#   → 9404 90EF 09DA 3132 2BF7  FD83 8758 49AB 1D54 1C55

# 3. Verify the signature on the checksum file (authenticity).
gpg --verify checksums.txt.asc checksums.txt        # "Good signature"

# 4. Verify the download matches the checksum (integrity).
shasum -a 256 -c checksums.txt                       # "OK"
```

A "Good signature" in step 3 and "OK" in step 4 mean the download is authentic
and untampered. The trust anchor is the primary fingerprint in step 2: it matches
the key GitHub serves at `https://github.com/whykusanagi.gpg`, and the signing
subkey is certified under it.

## Launching on macOS

The build is ad-hoc signed (not yet notarized through Apple), so macOS
quarantines it on first launch. After verifying above, unzip the app and either:

- Right-click `CelesteOps.app` and choose **Open**, then **Open** again, or
- Clear the quarantine flag:
  ```bash
  xattr -dr com.apple.quarantine /Applications/CelesteOps.app
  ```

You do this once. A future release may be Apple-notarized, which removes the step.
