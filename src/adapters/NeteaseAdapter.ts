/**
 * 网易云音乐适配器
 */

import crypto from 'crypto';
import { 
  Platform, 
  SearchQuery, 
  SearchResult, 
  SongDetail, 
  LyricData, 
  AudioQuality,
  SongInfo,
  AudioUrls,
  AdapterConfig
} from '../types';
import { BasePlatformAdapter } from '../core/BasePlatformAdapter';
import { logger } from '../lib/logger';

export class NeteaseAdapter extends BasePlatformAdapter {
  private readonly AES_KEY = Buffer.from('e82ckenh8dichen8');
  private readonly RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB
-----END PUBLIC KEY-----`;

  constructor(config: AdapterConfig) {
    super(Platform.NETEASE, config);
  }

  /**
   * 搜索歌曲
   */
  async search(query: SearchQuery): Promise<SearchResult> {
    const cacheKey = this.generateCacheKey('search', query.keyword, String(query.limit || 10));
    
    // 尝试从缓存获取
    const cached = await this.getFromCache<SearchResult>(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }

    const startTime = Date.now();
    
    try {
      const url = 'https://music.163.com/api/cloudsearch/pc';
      const data = new URLSearchParams({
        s: query.keyword,
        type: '1',
        limit: String(query.limit || 10),
        offset: String(query.offset || 0),
      }).toString();

      const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://music.163.com/',
        'Cookie': this.config.cookies || '',
      };

      const response = await this.httpClient.post(url, data, { headers });
      
      if (response.code !== 200 || !response.result || !response.result.songs) {
        throw new Error('Invalid response from Netease API');
      }

      const songs: SongInfo[] = response.result.songs.map((item: any) => ({
        id: String(item.id),
        name: item.name,
        artists: item.ar.map((artist: any) => artist.name),
        album: item.al.name,
        albumId: String(item.al.id),
        picUrl: item.al.picUrl.replace('http://', 'https://'),
        duration: item.dt,
        platform: Platform.NETEASE,
        platformData: {
          fee: item.fee,
          mvid: item.mv,
          popularity: item.pop,
        },
      }));

      const result: SearchResult = {
        status: 200,
        platform: Platform.NETEASE,
        total: response.result.songCount || songs.length,
        hasMore: (query.offset || 0) + songs.length < (response.result.songCount || 0),
        results: songs,
        responseTime: Date.now() - startTime,
      };

      // 缓存结果
      await this.setToCache(cacheKey, result);
      
      return result;
    } catch (error) {
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
      return { ...cached, cached: true };
    }

    const startTime = Date.now();

    try {
      // 并行获取歌曲URL、详情和歌词
      const [urlData, detailData, lyricData] = await Promise.all([
        this.fetchSongUrl(songId, quality),
        this.fetchSongDetail(songId),
        this.getLyric(songId),
      ]);

      if (!urlData.data?.[0]?.url) {
        throw new Error('Song URL not available');
      }

      const songData = urlData.data[0];
      const songInfo = detailData.songs?.[0] || {};

      const song: SongInfo = {
        id: songId,
        name: songInfo.name || '',
        artists: (songInfo.ar || []).map((a: any) => a.name),
        album: songInfo.al?.name || '',
        albumId: String(songInfo.al?.id || ''),
        picUrl: songInfo.al?.picUrl?.replace('http://', 'https://') || '',
        duration: songInfo.dt,
        platform: Platform.NETEASE,
        platformData: {
          fee: songInfo.fee,
          mvid: songInfo.mv,
          publishTime: songInfo.publishTime,
        },
      };

      const urls: AudioUrls = {
        [quality]: {
          url: songData.url.replace('http://', 'https://'),
          bitrate: this.getBitrateFromLevel(songData.level),
          size: this.formatSize(songData.size),
          format: songData.type || 'mp3',
        },
      };

      const result: SongDetail = {
        status: 200,
        platform: Platform.NETEASE,
        song,
        urls,
        lyric: lyricData,
        responseTime: Date.now() - startTime,
      };

      // 缓存结果
      await this.setToCache(cacheKey, result);
      
      return result;
    } catch (error) {
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
      const url = 'https://interface3.music.163.com/api/song/lyric';
      const data = new URLSearchParams({
        id: songId,
        lv: '-1',
        tv: '-1',
      }).toString();

      const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': this.config.cookies || '',
      };

      const response = await this.httpClient.post(url, data, { headers });

      const lyricData: LyricData = {
        original: response.lrc?.lyric || '',
        translated: response.tlyric?.lyric || '',
        romanized: response.romalrc?.lyric || '',
        timeline: this.parseLyricTimeline(response.lrc?.lyric || ''),
      };

      // 缓存歌词
      await this.setToCache(cacheKey, lyricData);
      
      return lyricData;
    } catch (error) {
      logger.warn(`Failed to get lyric for song ${songId}:`, error);
      return {
        original: '',
        translated: '',
        timeline: [],
      };
    }
  }

  /**
   * 获取歌曲播放URL
   */
  private async fetchSongUrl(songId: string, level: string): Promise<any> {
    const url = 'https://interface3.music.163.com/eapi/song/enhance/player/url/v1';
    const urlPath = '/api/song/enhance/player/url/v1';
    
    const payload: any = { 
      ids: JSON.stringify([songId]), 
      level, 
      encodeType: 'flac' 
    };
    
    if (level === 'sky') {
      payload.immerseType = 'c51';
    }

    const params = this.eapiEncrypt(urlPath, payload);
    const data = new URLSearchParams({ params }).toString();

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': this.config.cookies || '',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/2.10.2.200154',
    };

    return this.httpClient.post(url, data, { headers });
  }

  /**
   * 获取歌曲详情
   */
  private async fetchSongDetail(songId: string): Promise<any> {
    const url = 'https://interface3.music.163.com/api/v3/song/detail';
    const data = new URLSearchParams({
      c: JSON.stringify([{ id: songId }]),
    }).toString();

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    return this.httpClient.post(url, data, { headers });
  }

  /**
   * EAPI加密
   */
  private eapiEncrypt(urlPath: string, payload: any): string {
    const text = JSON.stringify(payload);
    const message = `nobody${urlPath}use${text}md5forencrypt`;
    const digest = crypto.createHash('md5').update(message).digest('hex');
    const data = `${urlPath}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
    
    const cipher = crypto.createCipheriv('aes-128-ecb', this.AES_KEY, null);
    return cipher.update(data, 'utf-8', 'hex') + cipher.final('hex');
  }

  /**
   * 解析歌词时间轴
   */
  private parseLyricTimeline(lyric: string): Array<{ time: number; text: string }> {
    const timeline: Array<{ time: number; text: string }> = [];
    const lines = lyric.split('\n');

    for (const line of lines) {
      const match = line.match(/\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/);
      if (match) {
        const minutes = parseInt(match[1]);
        const seconds = parseInt(match[2]);
        const milliseconds = parseInt(match[3].padEnd(3, '0'));
        const time = minutes * 60 * 1000 + seconds * 1000 + milliseconds;
        const text = match[4].trim();
        
        if (text) {
          timeline.push({ time, text });
        }
      }
    }

    return timeline.sort((a, b) => a.time - b.time);
  }

  /**
   * 根据level获取比特率描述
   */
  private getBitrateFromLevel(level: string): string {
    const levelMap: Record<string, string> = {
      standard: '128kbps',
      exhigh: '320kbps',
      lossless: 'FLAC',
      hires: 'Hi-Res',
      sky: 'Dolby Atmos',
      jyeffect: 'Surround',
      jymaster: 'Master',
    };
    return levelMap[level] || '128kbps';
  }

  /**
   * 格式化文件大小
   */
  private formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(2))} ${units[i]}`;
  }
}