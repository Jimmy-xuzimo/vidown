"""Web playback data adapters. No private session keys, signature generation or DRM bypass."""
import json
import re
from urllib.parse import urlsplit, parse_qs, urlencode, unquote


def pgc_target(url):
    u = urlsplit(url)
    if u.hostname not in ('bilibili.com', 'www.bilibili.com', 'm.bilibili.com'):
        return None
    m = re.fullmatch(r'/bangumi/(?:play/(ep|ss)|media/(md))(\d+)/?', u.path)
    return (m[1] or m[2], m[3]) if m else None


def pgc_probe(url, get_json, extract_formats):
    key, identity = pgc_target(url)
    api = 'https://api.bilibili.com/'
    if key == 'md':
        media = get_json(api + 'pgc/review/user?media_id=' + identity)
        season = (media.get('result') or {}).get('media', {}).get('season_id')
        if not str(season).isdigit():
            raise ValueError('影片信息不可用，请打开具体单集链接')
        return pgc_probe(f'https://www.bilibili.com/bangumi/play/ss{season}', get_json, extract_formats)
    season = get_json(api + 'pgc/view/web/season?' + urlencode({
        'ep_id' if key == 'ep' else 'season_id': identity}))
    if season.get('code') != 0:
        raise ValueError(f'影片信息不可用（{season.get("code")}），请确认登录、地区和访问权限')
    data = season.get('result') or {}
    # Sections often contain trailers/interviews; prefer the actual main episodes.
    episodes = data.get('episodes') or [ep for section in data.get('section') or [] for ep in section.get('episodes') or []]
    episodes = [e for e in episodes[:1000] if str(e.get('id')).isdigit()]
    episodes = list({str(e['id']): e for e in episodes}.values())
    if key == 'ss':
        if len(episodes) == 1:
            return pgc_probe(f'https://www.bilibili.com/bangumi/play/ep{episodes[0]["id"]}', get_json, extract_formats)
        if not episodes:
            raise ValueError('尚无可用单集，或当前账号无权访问')
        return {'title': data.get('title') or '选择单集或版本', '_vidown_episodes': [
            {'title': ' · '.join(str(e[k]) for k in ('title', 'long_title') if e.get(k)),
             'url': f'https://www.bilibili.com/bangumi/play/ep{e["id"]}'} for e in episodes],
            '_vidown_warnings': ['请选择一个单集或配音版本，再选择保存规格。不会批量下载整季。']}
    episode = next((e for e in episodes if str(e['id']) == identity), None)
    if not episode:
        raise ValueError('当前影片没有这个单集，请重新打开影片页选择')
    page = f'https://www.bilibili.com/bangumi/play/ep{identity}'
    raw = get_json(api + 'pgc/player/web/v2/playurl?' + urlencode({
        'ep_id': identity, 'fnval': 12240, 'fnver': 0, 'fourk': 1, 'qn': 127}))
    payload = raw.get('raw') or raw.get('data') or raw
    result = payload.get('result') or payload.get('data') or payload
    code = raw.get('code', payload.get('code'))
    if code:
        raise ValueError(f'播放权限不足或地区受限（{code}），请在浏览器确认本集可以完整播放后重试')
    info = result.get('video_info') or (result if result.get('dash') or result.get('durl') else {})
    if info.get('is_drm') or info.get('drm_tech_type') or result.get('is_drm'):
        raise ValueError('当前单集使用 DRM，无法保存受保护的媒体')
    if len(info.get('durl') or []) > 1 and not info.get('dash'):
        raise ValueError('当前单集仅返回多段旧式媒体，请在浏览器切换 DASH 画质后重试')
    formats = extract_formats(info)
    if not formats:
        raise ValueError('当前账号没有可保存的单集轨道，请确认地区、会员或购买权限')
    for f in formats:
        f['http_headers'] = {**f.get('http_headers', {}), 'Referer': page}
        if not f.get('vcodec') and not f.get('acodec') and not info.get('dash'):
            f.update(vcodec='unknown', acodec='unknown')
    warnings = []
    if (info.get('is_preview') or result.get('is_preview') or
            (result.get('play_check') or {}).get('play_detail') == 'PLAY_PREVIEW' or
            result.get('play_video_type') == 'preview'):
        warnings.append('当前账号仅获得试看内容，保存的不会是全片。请确认本集的会员或购买权限后重新解析。')
    return {'id': identity, 'webpage_url': page, 'title': ' · '.join(str(x) for x in (
        data.get('title'), episode.get('title'), episode.get('long_title')) if x),
        'formats': formats, 'duration': info.get('timelength', 0) / 1000 or None,
        'http_headers': {'Referer': page}, '_vidown_warnings': warnings}


DOUYIN_HOSTS = {'douyin.com', 'www.douyin.com', 'v.douyin.com', 'iesdouyin.com', 'www.iesdouyin.com'}


def douyin_id(url):
    u = urlsplit(url)
    if u.hostname not in DOUYIN_HOSTS or u.scheme not in ('https', 'http'):
        return None
    m = re.match(r'^/(?:share/)?video/(\d+)(?:/|$)', u.path)
    query = parse_qs(u.query)
    identity = m[1] if m else (query.get('modal_id') or query.get('vid') or [''])[0]
    return identity if re.fullmatch(r'\d{8,24}', identity) else None


def douyin_data(values, identity):
    """Select exact string ID; recommendations and precision-lost numeric IDs are rejected."""
    pending = [(values, 0)]
    detail = None
    for _ in range(30000):
        if not pending:
            break
        value, depth = pending.pop()
        if depth > 18:
            continue
        if isinstance(value, dict):
            if (value.get('aweme_id') == identity or value.get('awemeId') == identity) and value.get('video'):
                detail = value
                break
            pending.extend((v, depth + 1) for v in value.values() if isinstance(v, (dict, list)))
        elif isinstance(value, list):
            pending.extend((v, depth + 1) for v in value if isinstance(v, (dict, list)))
    if not detail:
        return None
    video = detail['video']
    if any(video.get(k) for k in ('is_drm', 'isDrm', 'drm_type', 'drmType')):
        raise ValueError('该媒体使用受保护的加密方式，无法保存')
    rates = video.get('bit_rate') or video.get('bitRateList') or video.get('bitRate') or []
    variants = [*(rates if isinstance(rates, list) else []),
                {'play_addr': video.get('play_addr') or video.get('playAddr')}]
    formats, seen = [], set()
    def positive(value):
        return value if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0 else None
    for rate in variants[:200]:
        if not isinstance(rate, dict) or rate.get('is_drm') or rate.get('isDrm'):
            continue
        address = rate.get('play_addr') or rate.get('playAddr') or {}
        if not isinstance(address, dict):
            continue
        locations = address.get('url_list') or address.get('urlList') or []
        urls = []
        for raw in locations[:8] if isinstance(locations, list) else []:
            if not isinstance(raw, str):
                continue
            raw = 'https:' + raw if raw.startswith('//') else raw
            u = urlsplit(raw)
            if u.scheme in ('http', 'https') and u.hostname and not u.username and not u.password and raw not in urls:
                urls.append(raw)
        if not urls or urls[0] in seen:
            continue
        seen.add(urls[0])
        formats.append({'format_id': str(len(formats)), 'url': urls[0], '_vidown_mirrors': urls[1:],
            'width': positive(address.get('width') or rate.get('width') or video.get('width')),
            'height': positive(address.get('height') or rate.get('height') or video.get('height')),
            'fps': positive(rate.get('fps') or video.get('fps')),
            'tbr': (positive(rate.get('bit_rate') or rate.get('bitRate')) or 0) / 1000 or None,
            'vcodec': 'hevc' if (rate.get('is_h265') or rate.get('isH265')) else 'unknown',
            'acodec': 'unknown', 'protocol': 'https', 'http_headers': {'Referer': 'https://www.douyin.com/'}})
    if not formats:
        return None
    return {'id': identity, 'title': str(detail.get('desc') or detail.get('caption') or f'视频 {identity}')[:500],
        'webpage_url': f'https://www.douyin.com/video/{identity}', 'formats': formats,
        'duration': (positive(video.get('duration') or detail.get('duration')) or 0) / 1000 or None,
        '_vidown_warnings': ['仅显示当前网页实际返回的源规格；未知编码和音频参数将在保存后验证。']}


def douyin_html(html, identity):
    for match in re.finditer(r'<script\b[^>]*\bid=["\'](?:RENDER_DATA|__NEXT_DATA__)["\'][^>]*>(.*?)</script>', html, re.S):
        try:
            parsed = json.loads(unquote(match[1]))
        except (ValueError, TypeError):
            continue
        value = douyin_data(parsed, identity)
        if value:
            return value
    return None
