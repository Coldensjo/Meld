---
layout: home

hero:
  name: Meld
  text: A map editor for World of Warcraft 1.12.1
  tagline: Create a world or edit part of Azeroth. Sculpt terrain, paint textures and place models, then bring your work into your own client and VMaNGOS server.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: Read the manual
      link: /MANUAL

features:
  - title: Make your first map
    details: Connect a 1.12.1 client, choose a starting region and learn the editing basics.
    link: /getting-started
  - title: Save and compile safely
    details: Understand working files, client patches, server data and pending writes before playing your changes.
    link: /guides/saving-and-compiling
  - title: Build or contribute
    details: Set up the desktop application, find the relevant code and choose the right tests.
    link: /development
---

## Choose your next step

- **New to Meld?** Follow [Getting started](getting-started.md), then keep the [manual](MANUAL.md) nearby.
- **Ready to play a map?** Read [Saving, compiling and playing](guides/saving-and-compiling.md).
- **Something went wrong?** Check [Troubleshooting](troubleshooting.md) before changing client files.
- **Backing up or sharing settings?** Read [Settings, local data and backups](guides/settings-and-data.md).
- **Working on Meld itself?** Start with [Development](development.md), [Architecture](architecture/index.md)
  and [Testing](TESTS.md).

Meld runs on **Windows and Linux** and targets **World of Warcraft 1.12.1**. It reads assets from
your own client and ships no Blizzard data. VMaNGOS server automation currently uses Windows tooling;
see the [compile guide](guides/saving-and-compiling.md) before setting up a server workflow.

Detailed investigations are preserved in the [engineering notebooks](reference/index.md), separate
from the everyday guides.
