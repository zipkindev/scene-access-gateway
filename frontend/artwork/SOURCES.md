# Artwork sources and redistribution review

This register records the origin and publication boundary for repository
artwork and audio.

| Asset group | Origin | License/permission | Public status |
| --- | --- | --- | --- |
| Rain-city portal backgrounds | Generated for this project during TNAS-Migrate development | CC BY 4.0 | Included |
| Scene bundles | Generated for this project during TNAS-Migrate development | CC BY 4.0 | Included |
| Motion layers | Derived for this project from its generated artwork | CC BY 4.0 | Included |
| Additional scene concepts | Generated for this project; prompt record retained | CC BY 4.0 | Included |
| Ambient audio samples | Pixabay source pages listed below | Pixabay Content License | Manifest only; raw files excluded from Git |

## Audio register

Each file's Pixabay page makes it available under the Pixabay Content License.
That license permits use and adaptation without required attribution, but
prohibits distributing substantially unchanged content on a standalone basis.
The raw files are therefore excluded from Git. Operators may download them
under the applicable terms, place them in `.local/audio-source/`, and run
`scripts/import-audio.sh .local/audio-source`; the importer accepts only the
complete byte-for-byte verified set.

| File | Creator shown by Pixabay | Source | SHA-256 |
| --- | --- | --- | --- |
| `freesound_community-ambient-neuro-bass-beat-27709.mp3` | Bertsz (Freesound) | <https://pixabay.com/sound-effects/musical-ambient-neuro-bass-beat-27709/> | `2f3be606eea0adf6836f865c27b63fb2a8e05c9a12639a8ebd6fbd36f90aeb78` |
| `freesound_community-ambient-piano-loop-85bpm-40993.mp3` | deleted_user_11009121 (Freesound) | <https://pixabay.com/sound-effects/musical-ambient-piano-loop-85bpm-40993/> | `3bb46436bb2277b68d3d9acfee816d94829ba7ad06c988b087cfd7490070f43b` |
| `freesound_community-calm-loop-80576.mp3` | DragonTrance (Freesound) | <https://pixabay.com/sound-effects/musical-calm-loop-80576/> | `9a6fa7efde06aca985e11234cd3c8eb9d980daa8f95f2443f4228c5a5f0db07e` |
| `freesound_community-forcefield-ambience-67572.mp3` | Thimblerig (Freesound) | <https://pixabay.com/sound-effects/film-special-effects-forcefield-ambience-67572/> | `c9b0ff0dfa891901aaf8b5586546ddcffc9c5c05f04b9c6b790f6b7e6fcb837f` |
| `freesound_community-hardstyle-atmos01_fmin_150bpm-94733.mp3` | Sorinious_Genious (Freesound) | <https://pixabay.com/sound-effects/musical-hardstyle-atmos01-fmin-150bpm-94733/> | `cea716988322bdf129bdc93977498e6d82949e45e3f027ac8b8abd865d042634` |
| `freesound_community-spooky-keys-63764.mp3` | IsThisUserTaken (Freesound) | <https://pixabay.com/sound-effects/spooky-keys-63764/> | `5643c4cd26027de76f5c1787a8370c3c186850076ad42b915516155aebc25364` |
| `gigidelaromusic-calm-ether-loop-short-450954.mp3` | GigiDeLaRoMusic | <https://pixabay.com/sound-effects/musical-calm-ether-loop-short-450954/> | `dedb21d9703a8df3b0438447af8ae823f9e6e615c56828575d7ede60a9f5685e` |
| `grumpynora-delightful-loop-380173.mp3` | Grumpynora | <https://pixabay.com/sound-effects/delightful-loop-380173/> | `f693bb61d7dbc2f367d4e793469b3309b8cc872b6f9043e80e89e9c3524fcba1` |

License summary: <https://pixabay.com/service/license-summary/>. This source
register is a provenance record, not legal advice or a relicensing of the
underlying audio.

The CC BY 4.0 grant and its scope are recorded in `LICENSE.md`; its full legal
text is in `LICENSE-CC-BY-4.0.txt`. Audio is expressly excluded from that grant.

The machine-readable record in `audio/manifest.json` is authoritative for
filenames, source pages, byte lengths, SHA-256 identities, Future-table cycle
order, and loop boundaries. `scripts/verify-build-inputs.sh` rejects drift.
