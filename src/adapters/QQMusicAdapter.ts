/**
 * QQ音乐平台适配器
 */

import { BasePlatformAdapter } from '../core/BasePlatformAdapter';
import {
  Platform,
  SearchQuery,
  SearchResult,
  SongDetail,
  LyricData,
  AudioQuality,
  AdapterConfig,
  SongInfo,
  AudioUrls
} from '../types';
import { logger } from '../lib/logger';

export class QQMusicAdapter extends BasePlatformAdapter {

  constructor(config: AdapterConfig) {
    super(Platform.QQ, config);
  }

  /**
   * 搜索歌曲
   */
  async search(query: SearchQuery): Promise<SearchResult> {
    const cacheKey = this.generateCacheKey('search', query.keyword, String(query.limit || 10), String(query.offset || 0));
    
    // 尝试从缓存获取
    const cached = await this.getFromCache<SearchResult>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const startTime = Date.now();

      // 使用简单的smartbox API，无需复杂签名
      const timestamp = Date.now();
      const url = `https://c6.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?_=${timestamp}&cv=4747474&ct=24&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=1&uin=0&g_tk_new_20200303=5381&g_tk=5381&hostUin=0&is_xml=0&key=${encodeURIComponent(query.keyword)}`;

      logger.info(`QQ Music search URL:`, { url });

      // 发送GET请求
      const response = await this.httpClient.get(url, {
        headers: {
          'Referer': 'https://y.qq.com/',
          'User-Agent': this.config.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
        }
      });

      const responseTime = Date.now() - startTime;

      logger.info(`QQ Music search response:`, response);

      // 检查响应格式
      if (!response || typeof response !== 'object') {
        throw new Error('Invalid response format');
      }

      // 检查响应状态
      if (response.code !== 0) {
        throw new Error(`API returned error: ${response.message || 'Unknown error'}`);
      }

      // 解析歌曲数据
      const songData = response.data?.song?.itemlist || [];
      if (songData.length === 0) {
        logger.warn(`No search results found for "${query.keyword}"`);
        return {
          status: 200,
          platform: Platform.QQ,
          total: 0,
          hasMore: false,
          results: [],
          responseTime,
        };
      }

      // 应用分页限制
      const offset = query.offset || 0;
      const limit = query.limit || 10;
      const paginatedSongs = songData.slice(offset, offset + limit);

      // 转换为标准格式
      const results: SongInfo[] = paginatedSongs.map((song: any) => ({
        id: String(song.mid || song.songmid),
        name: song.name || song.songname || song.title,
        artists: typeof song.singer === 'string' ? [song.singer] :
                 (Array.isArray(song.singer) ? song.singer.map((s: any) => s.name || s) : ['Unknown']),
        album: song.album || '',
        duration: song.interval || song.duration || 0,
        platform: Platform.QQ,
        picUrl: song.mid ?
          `https://y.gtimg.cn/music/photo_new/T002R300x300M000${song.mid}.jpg` : '',
        platformData: {
          songmid: song.mid || song.songmid,
          albummid: song.albummid,
          strMediaMid: song.strMediaMid,
          pubtime: song.pubtime
        }
      }));

      const result: SearchResult = {
        status: 200,
        platform: Platform.QQ,
        total: songData.length,
        hasMore: (offset + limit) < songData.length,
        results,
        responseTime,
      };

      // 缓存结果
      await this.setToCache(cacheKey, result);
      
      logger.info(`QQ Music search completed: ${results.length} results for "${query.keyword}"`);
      return result;

    } catch (error: any) {
      logger.error(`QQ Music search failed for "${query.keyword}":`, error);
      throw this.handleApiError(error, 'search');
    }
  }

  /**
   * 获取歌曲详情
   */
  async getSong(songId: string, quality: AudioQuality = AudioQuality.STANDARD): Promise<SongDetail> {
    const cacheKey = this.generateCacheKey('song', songId, quality);
    
    // 尝试从缓存获取
    const cached = await this.getFromCache<SongDetail>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const startTime = Date.now();

      // 获取歌曲基本信息
      const infoResponse = await this.httpClient.get('https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg', {
        params: {
          songmid: songId,
          tpl: 'yqq_song_detail',
          format: 'json',
          callback: '',
          g_tk: 5381,
          jsonpCallback: '',
          loginUin: 0,
          hostUin: 0,
          inCharset: 'utf8',
          outCharset: 'utf-8',
          notice: 0,
          platform: 'yqq.json',
          needNewCode: 0
        },
        headers: {
          'Referer': 'https://y.qq.com/',
          'User-Agent': this.config.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!infoResponse.data || infoResponse.data.code !== 0) {
        throw new Error(`Failed to get song info: ${infoResponse.data?.message || 'Unknown error'}`);
      }

      const songInfo = infoResponse.data.data?.[0];
      if (!songInfo) {
        throw new Error('Song not found');
      }

      // 获取播放URL
      const urls = await this.getPlayUrls(songId);
      
      // 获取歌词
      const lyric = await this.getLyric(songId);

      const responseTime = Date.now() - startTime;

      const song: SongInfo = {
        id: songId,
        name: songInfo.songname,
        artists: songInfo.singer?.map((s: any) => s.name) || ['Unknown'],
        album: songInfo.albumname || '',
        duration: songInfo.interval || 0,
        platform: Platform.QQ,
        picUrl: songInfo.albummid ? 
          `https://y.gtimg.cn/music/photo_new/T002R500x500M000${songInfo.albummid}.jpg` : '',
        platformData: {
          songmid: songId,
          albummid: songInfo.albummid,
          strMediaMid: songInfo.strMediaMid,
          pubtime: songInfo.pubtime
        }
      };

      const result: SongDetail = {
        status: 200,
        platform: Platform.QQ,
        song,
        urls,
        lyric,
        responseTime,
      };

      // 缓存结果
      await this.setToCache(cacheKey, result);
      
      logger.info(`QQ Music song details retrieved: ${song.name} by ${song.artists.join(', ')}`);
      return result;

    } catch (error: any) {
      logger.error(`QQ Music getSong failed for ${songId}:`, error);
      throw this.handleApiError(error, 'getSong');
    }
  }

  /**
   * 获取歌词
   */
  async getLyric(songId: string): Promise<LyricData> {
    const cacheKey = this.generateCacheKey('lyric', songId);
    
    // 尝试从缓存获取
    const cached = await this.getFromCache<LyricData>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const startTime = Date.now();

      // 使用简化的歌词API
      const response = await this.httpClient.get('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg', {
        params: {
          songmid: songId,
          format: 'json',
          callback: '',
          g_tk: 5381,
          jsonpCallback: '',
          loginUin: 0,
          hostUin: 0,
          inCharset: 'utf8',
          outCharset: 'utf-8',
          notice: 0,
          platform: 'yqq.json',
          needNewCode: 0
        },
        headers: {
          'Referer': 'https://y.qq.com/',
          'User-Agent': this.config.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      logger.info(`QQ Music lyric response:`, { responseData: response.data });

      if (!response.data || response.data.code !== 0) {
        throw new Error(`Failed to get lyrics: ${response.data?.message || 'Unknown error'}`);
      }

      // 解码Base64歌词
      const lyricBase64 = response.data.lyric;
      const transLyricBase64 = response.data.trans;
      
      let lyricText = '';
      let translatedLyric = '';
      
      if (lyricBase64) {
        lyricText = Buffer.from(lyricBase64, 'base64').toString('utf-8');
      }
      
      if (transLyricBase64) {
        translatedLyric = Buffer.from(transLyricBase64, 'base64').toString('utf-8');
      }

      const result: LyricData = {
        original: lyricText,
        translated: translatedLyric || undefined,
        timeline: this.parseLyricTimeline(lyricText),
      };

      // 缓存结果
      await this.setToCache(cacheKey, result);
      
      logger.info(`QQ Music lyrics retrieved for song ${songId}`);
      return result;

    } catch (error: any) {
      logger.warn(`QQ Music getLyric failed for song ${songId}:`, error);
      
      // 返回空歌词而不是抛出错误
      return {
        original: '',
        timeline: [],
      };
    }
  }

  /**
   * 获取播放URLs
   */
  private async getPlayUrls(songId: string): Promise<AudioUrls> {
    const urls: AudioUrls = {};

    try {
      // 使用简化的播放URL API
      const response = await this.httpClient.get('https://c.y.qq.com/base/fcgi-bin/fcg_music_express_mobile3.fcg', {
        params: {
          songmid: songId,
          filename: `M500${songId}.mp3`,
          guid: '10000',
          format: 'json',
          callback: '',
          g_tk: 5381,
          jsonpCallback: '',
          loginUin: 0,
          hostUin: 0,
          inCharset: 'utf8',
          outCharset: 'utf-8',
          notice: 0,
          platform: 'yqq.json',
          needNewCode: 0
        },
        headers: {
          'Referer': 'https://y.qq.com/',
          'User-Agent': this.config.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      logger.info(`QQ Music play URL response:`, { responseData: response.data });

      if (response.data && response.data.data && response.data.data.items && response.data.data.items.length > 0) {
        const urlInfo = response.data.data.items[0];
        if (urlInfo.vkey) {
          const baseUrl = `https://dl.stream.qqmusic.qq.com/M500${songId}.mp3?guid=10000&vkey=${urlInfo.vkey}&uin=0&fromtag=66`;
          
          // 标准音质
          urls[AudioQuality.STANDARD] = {
            url: baseUrl,
            bitrate: '128',
            format: 'mp3'
          };

          // 高音质
          urls[AudioQuality.HIGH] = {
            url: baseUrl.replace('M500', 'M800'),
            bitrate: '320',
            format: 'mp3'
          };

          // 无损音质
          urls[AudioQuality.LOSSLESS] = {
            url: baseUrl.replace('M500', 'F000').replace('.mp3', '.flac'),
            bitrate: '1411',
            format: 'flac'
          };
        }
      }
    } catch (error) {
      logger.warn(`Failed to get play URLs for ${songId}:`, error);
    }

    return urls;
  }

  /**
   * 解析歌词时间轴
   */
  private parseLyricTimeline(lyricText: string) {
    const lines = lyricText.split('\n');
    const timeline = [];

    for (const line of lines) {
      const match = line.match(/\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/);
      if (match) {
        const minutes = parseInt(match[1]);
        const seconds = parseInt(match[2]);
        const milliseconds = parseInt(match[3].padEnd(3, '0'));
        const text = match[4].trim();

        if (text) {
          timeline.push({
            time: minutes * 60 * 1000 + seconds * 1000 + milliseconds,
            text,
          });
        }
      }
    }

    return timeline.sort((a, b) => a.time - b.time);
  }
}