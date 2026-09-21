(function () {
  const namespace = (window.AutoMcGraw = window.AutoMcGraw || {});

  function normalize(value) {
    return String(value == null ? "" : value)
      .replace(/\s+/g, " ")
      .trim();
  }

  function labelFor(choice, index) {
    const label = normalize(choice && choice.label);
    if (label) return label;
    return String.fromCharCode(65 + index);
  }

  function formatChoices(choices) {
    if (!Array.isArray(choices) || !choices.length) return "";
    return choices
      .map((choice, index) => `${labelFor(choice, index)}. ${normalize(choice.text)}`)
      .join("\n");
  }

  function instructionsFor(questionType) {
    switch (questionType) {
      case "multiple-select":
        return 'Several choices are correct. "answer" must be an array of the exact choice labels, for example ["A", "C"].';
      case "fill-in-the-blank":
        return '"answer" must be only the text that belongs in the blank.';
      case "true-false":
        return '"answer" must be exactly "True" or "False".';
      case "matching":
        return '"answer" must be an object mapping each left-hand item to its match.';
      default:
        return 'Exactly one choice is correct. "answer" must be that choice\'s label, for example "B".';
    }
  }

  function buildPrompt(questionData) {
    const data = questionData || {};
    const parts = [];

    parts.push(
      "Answer this question from a McGraw Hill Smartbook assignment."
    );
    parts.push(instructionsFor(data.questionType));
    parts.push(
      'Reply with one JSON object and nothing else: no preamble, no code fence, no text after it. ' +
        'It must have exactly two keys, "answer" first and "explanation" second. ' +
        "Keep the explanation under 200 characters."
    );

    if (data.instructions) {
      parts.push(`Instructions: ${normalize(data.instructions)}`);
    }

    parts.push(`Question: ${normalize(data.questionText)}`);

    const choices = formatChoices(data.choices);
    if (choices) {
      parts.push(`Choices:\n${choices}`);
    }

    parts.push('{"answer": ..., "explanation": "..."}');

    return parts.join("\n\n");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function toParagraphs(value) {
    return String(value)
      .split("\n")
      .map((line) => `<p>${escapeHtml(line) || "<br>"}</p>`)
      .join("");
  }

  namespace.escapeHtml = escapeHtml;
  namespace.toParagraphs = toParagraphs;
  namespace.normalize = normalize;
  namespace.labelFor = labelFor;
  namespace.buildPrompt = buildPrompt;
})();
