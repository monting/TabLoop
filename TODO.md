- offer an escape hatch button to open a new tab outside the limit. button is only accessible in the extension popup. 
- show overage count in the UI

- [x] setting to add domains that get skipped when resurfacing - e.g. youtube.com
- [x] settings to add a priority resurface domain or keyword. this supercedes order of resurface
- update description.md with this latest stash syncing feature. then commit the code for this feature

- [x] only show badge, when remaining slots are low



- setting to add domains that get skipped when resurfacing - e.g. youtube.com
- settings to add a priority resurface domain or keyword. this supercedes order of resurface


- when there's only one (or a few of) tab that's prioritized to resurface, the looping goes through these, instead of moving on to others.
a solution might be: keep a record of the most recently resurfaced tabs, with their last resurfaced timestamp. if a tab has been resurfaced within the last X minutes, don't resurface them. make X configurable in settings.
