const fs = require("fs");

const bannedWords = fs
  .readFileSync("./bannedwords.txt", "utf8")
  .split("\n")
  .map(w => w.trim().toLowerCase())
  .filter(Boolean);

function censor(word) {
  if (word.length <= 2) return "*".repeat(word.length);

  return word[0] + "*".repeat(word.length - 2) + word[word.length - 1];
}

function filterText(text) {
  if (typeof text !== "string") {
    return "";
  }

  let result = text;

  for (const badWord of bannedWords) {

    result = result.replaceAll(badWord, censor(badWord));
  }

  return result;
}

module.exports = {
  filterText
};