#!/usr/bin/env python3
"""Place the Herdr Space action on every empty key of an OpenDeck profile.

Usage: fill-profile.py [profile.json]. Defaults to the first device profile it
finds. Keys that already hold any action are left untouched — placement is how
the user reserves keys. Quit OpenDeck before running; it holds profiles in
memory and overwrites external edits on save.
"""
import glob
import json
import os
import sys

PLUGIN = "com.thomasrooney.herdrdeck.sdPlugin"
ACTION = "com.thomasrooney.herdrdeck.space"
ICON = f"plugins/{PLUGIN}/icons/space.svg"

STATE = {
    "alignment": "middle",
    "background_colour": "#000000",
    "colour": "#FFFFFF",
    "family": "Liberation Sans",
    "image": ICON,
    "image_scale": 100,
    "name": "",
    "show": True,
    "size": 16,
    "stroke_colour": "#000000",
    "stroke_size": 3,
    "style": "Regular",
    "text": "",
    "underline": False,
}


def instance(slot):
    return {
        "action": {
            "controllers": ["Keypad"],
            "disable_automatic_states": True,
            "encoder": None,
            "icon": ICON,
            "name": "Herdr Space",
            "plugin": PLUGIN,
            "property_inspector": "",
            "states": [dict(STATE)],
            "supported_in_multi_actions": False,
            "tooltip": "Live tile for a Herdr workspace; press to focus it",
            "uuid": ACTION,
            "visible_in_action_list": True,
        },
        "children": None,
        "context": f"Keypad.{slot}.0",
        "current_state": 0,
        "settings": {},
        "states": [dict(STATE)],
    }


def default_profile():
    base = os.path.expanduser("~/Library/Application Support/opendeck/profiles")
    if sys.platform.startswith("linux"):
        base = os.path.join(
            os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share")),
            "opendeck",
            "profiles",
        )
    matches = sorted(glob.glob(os.path.join(base, "*", "*.json")))
    if not matches:
        sys.exit("no OpenDeck profiles found")
    return matches[0]


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else default_profile()
    with open(path) as handle:
        profile = json.load(handle)
    filled = 0
    for slot, key in enumerate(profile["keys"]):
        if key is None:
            profile["keys"][slot] = instance(slot)
            filled += 1
    with open(path, "w") as handle:
        json.dump(profile, handle, indent="\t")
    print(f"filled {filled} empty keys in {path}")


if __name__ == "__main__":
    main()
