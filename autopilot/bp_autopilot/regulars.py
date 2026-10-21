"""Kill Tony regulars: a soft prior for the regular-vs-bucket-pull classifier (never required).

KNOWN = long-time regulars / frequent "Kill Tony family" performers (names as fans write them, plus common
transcription variants). The feed description of each episode also lists that night's regulars next to the guests
and the band/crew; autopilot.py adds those (minus CREW and the guests in the title) per episode.
"""
KNOWN = [
    "William Montgomery", "Hans Kim", "David Lucas", "Kam Patterson", "Casey Rocket", "Ari Matti", "Michael Lehrman",
    "Dedrick Flynn", "Pat O'Neill", "Timmy No Brakes", "Uncle Lazer", "Uncle Laser", "Kristie Nova", "Ellis Aych",
    "Sara Weinshenk", "Heather McMahan", "Yoni",
]
# band / crew / hosts that appear in every feed description but never do a set
CREW = {"tony hinchcliffe", "brian redban", "d madness", "michael a. gonzales", "jon deas", "matthew muehling",
        "joe white", "troy conrad", "grooveline horns", "the grooveline horns"}


def likely_from_roster(roster, guests=()):
    """Tonight's feed roster minus the title guests and the band/crew = probably tonight's regulars."""
    g = {x.lower() for x in guests}
    return [n for n in roster if n.lower() not in CREW and n.lower() not in g]
