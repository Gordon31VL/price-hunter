export function isAllowedChannel(channelId, allowedChannelId) {
  return Boolean(channelId && allowedChannelId && channelId === allowedChannelId);
}
