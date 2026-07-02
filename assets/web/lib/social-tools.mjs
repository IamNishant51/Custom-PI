export async function handlePostToTwitter(args, findSimilarPosted, postToTwitter, addPostedEntry) {
  if (!args.force) {
    const similar = findSimilarPosted("twitter", args.text);
    if (similar.length > 0 && similar[0].similarity > 0.4) {
      const s = similar[0];
      return `⚠️ Similar content already posted on ${s.entry.postedAt.slice(0, 10)} (${Math.round(s.similarity * 100)}% match): "${s.entry.fullContent?.slice(0, 100)}". Write something fresh and try again, or set force: true to override.`;
    }
  }
  const result = await postToTwitter(args.text, args.mediaPath);
  addPostedEntry("twitter", args.text, args.topic || "", result);
  return result;
}

export async function handlePostToReddit(args, findSimilarPosted, postToReddit, addPostedEntry) {
  if (!args.force) {
    const redditSimilar = findSimilarPosted("reddit", (args.title || "") + " " + (args.text || ""));
    if (redditSimilar.length > 0 && redditSimilar[0].similarity > 0.4) {
      const s = redditSimilar[0];
      return `⚠️ Similar Reddit post already on ${s.entry.postedAt.slice(0, 10)} (${Math.round(s.similarity * 100)}% match). Write something fresh or use force: true.`;
    }
  }
  const redditResult = await postToReddit(args.subreddit, args.title, args.text, args.mediaPath);
  addPostedEntry("reddit", (args.title || "") + " " + (args.text || ""), args.topic || "", redditResult);
  return redditResult;
}

export async function handlePostToBluesky(args, findSimilarPosted, postToBluesky, addPostedEntry) {
  if (!args.force) {
    const bskySimilar = findSimilarPosted("bluesky", args.text);
    if (bskySimilar.length > 0 && bskySimilar[0].similarity > 0.4) {
      const s = bskySimilar[0];
      return `⚠️ Similar Bluesky post already on ${s.entry.postedAt.slice(0, 10)} (${Math.round(s.similarity * 100)}% match). Write something fresh or use force: true.`;
    }
  }
  const bskyResult = await postToBluesky(args.text, args.mediaPath);
  addPostedEntry("bluesky", args.text, args.topic || "", bskyResult);
  return bskyResult;
}

export async function handlePostToDiscord(args, findSimilarPosted, postToDiscord, addPostedEntry) {
  if (!args.force) {
    const discordSimilar = findSimilarPosted("discord", args.message);
    if (discordSimilar.length > 0 && discordSimilar[0].similarity > 0.4) {
      const s = discordSimilar[0];
      return `⚠️ Similar Discord message already on ${s.entry.postedAt.slice(0, 10)} (${Math.round(s.similarity * 100)}% match). Write something fresh or use force: true.`;
    }
  }
  const discordResult = await postToDiscord(args.message, args.mediaPath);
  addPostedEntry("discord", args.message, args.topic || "", discordResult);
  return discordResult;
}

export async function handlePostToTelegram(args, findSimilarPosted, postToTelegram, addPostedEntry) {
  if (!args.force) {
    const tgSimilar = findSimilarPosted("telegram", args.message);
    if (tgSimilar.length > 0 && tgSimilar[0].similarity > 0.4) {
      const s = tgSimilar[0];
      return `⚠️ Similar Telegram message already on ${s.entry.postedAt.slice(0, 10)} (${Math.round(s.similarity * 100)}% match). Write something fresh or use force: true.`;
    }
  }
  const tgResult = await postToTelegram(args.message, args.mediaPath);
  addPostedEntry("telegram", args.message, args.topic || "", tgResult);
  return tgResult;
}
