"""Corpus-level edit-distance CER/WER; no external metric download required."""
def distance(reference, hypothesis):
    previous = list(range(len(hypothesis) + 1))
    for i, expected in enumerate(reference, 1):
        current = [i]
        for j, actual in enumerate(hypothesis, 1):
            current.append(min(current[-1] + 1, previous[j] + 1, previous[j - 1] + (expected != actual)))
        previous = current
    return previous[-1]


def error_rates(references, hypotheses):
    if not references or len(references) != len(hypotheses):
        raise ValueError("Nonempty, equally sized reference and hypothesis lists required.")
    chars = sum(len(x) for x in references)
    words = sum(len(x.split()) for x in references)
    if not chars or not words:
        raise ValueError("Reference corpus must contain characters and words.")
    char_errors = sum(distance(r, h) for r, h in zip(references, hypotheses))
    word_errors = sum(distance(r.split(), h.split()) for r, h in zip(references, hypotheses))
    return {"cer": char_errors / chars, "wer": word_errors / words,
            "character_errors": char_errors, "reference_characters": chars,
            "word_errors": word_errors, "reference_words": words}
