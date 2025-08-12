/**
 * 酷狗音乐平台适配器
 * 基于逆向接口实现
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
import crypto from 'crypto';

export class KugouAdapter extends BasePlatformAdapter {
  private readonly SECRET_KEY = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt';

  constructor(config: AdapterConfig) {
    super(Platform.KUGOU, config);
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

      // 直接使用移动端API进行搜索
      const result = await this.mobileSearch(query);
      
      // 缓存结果
      await this.setToCache(cacheKey, result);
      
      logger.info(`Kugou search completed: ${result.results.length} results for "${query.keyword}"`);
      return result;

    } catch (error: any) {
      logger.error(`Kugou search failed for "${query.keyword}":`, error);
      throw this.handleApiError(error, 'search');
    }
  }

  /**
   * 移动端搜索接口
   */
  private async mobileSearch(query: SearchQuery): Promise<SearchResult> {
    const startTime = Date.now();
    
    const url = 'http://mobilecdn.kugou.com/api/v3/search/song';
    const params = {
      format: 'json',
      keyword: query.keyword,
      page: Math.floor((query.offset || 0) / (query.limit || 10)) + 1,
      pagesize: query.limit || 10,
      showtype: 1,
    };
    const headers = {
      'User-Agent': this.config.userAgent || 'Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46'
    };

    logger.info(`Making Kugou mobile API request:`, {
      url,
      params,
      headers
    });

    const response = await this.httpClient.get(url, { params, headers });

    const responseTime = Date.now() - startTime;

    logger.info(`Kugou mobile search raw response:`, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      dataType: typeof response.data,
      dataLength: response.data ? JSON.stringify(response.data).length : 0,
      data: response.data
    });

    if (!response.data) {
      logger.error('Kugou API returned empty data');
      throw new Error('No response data from Kugou API');
    }

    // 检查响应数据结构 - 移动端API直接返回数据，没有status字段
    if (!response.data.info || !Array.isArray(response.data.info)) {
      logger.error(`Kugou API data structure error:`, {
        hasInfo: !!response.data.info,
        infoType: typeof response.data.info,
        fullResponse: response.data
      });
      throw new Error(`Kugou API error: Invalid response structure`);
    }

    const songList = response.data.info || [];
    const results: SongInfo[] = songList.map((song: any) => ({
      id: song.hash,
      name: song.songname,
      artists: [song.singername],
      album: song.album_name || '',
      duration: song.duration || 0,
      platform: Platform.KUGOU,
      picUrl: song.trans_param?.union_cover?.replace('{size}', '400') || '',
      platformData: {
        hash: song.hash,
        album_id: song.album_id,
        mvhash: song.mvhash,
        privilege: song.privilege,
        filesize: song.filesize,
        audio_id: song.audio_id,
        '320hash': song['320hash'],
        sqhash: song.sqhash
      }
    }));

    logger.info(`Kugou search parsed ${results.length} songs from response`);

    return {
      status: 200,
      platform: Platform.KUGOU,
      total: response.data.total || 0,
      hasMore: ((query.offset || 0) + (query.limit || 10)) < (response.data.total || 0),
      results,
      responseTime,
    };
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

      // 酷狗歌曲信息接口
      const time = Date.now();
      const mid = this.generateMid();
      const dfid = mid;
      const userid = '0';

      // 构建签名参数
      const signParams = [
        this.SECRET_KEY,
        'appid=1014',
        `clienttime=${time}`,
        'clientver=20000',
        `dfid=${dfid}`,
        `encode_album_audio_id=${songId}`,
        `mid=${mid}`,
        'platid=4',
        'srcappid=2919',
        'token=714d199ee4813ecd5031ce9b2fece0a309bce9d258baff7e3c31bff27ed9f977',
        `userid=${userid}`,
        `uuid=${mid}`,
        this.SECRET_KEY,
      ];

      const signature = this.generateSignature(signParams);

      const response = await this.httpClient.get('https://wwwapi.kugou.com/play/songinfo', {
        params: {
          srcappid: '2919',
          clientver: '20000',
          clienttime: time,
          mid: mid,
          uuid: mid,
          dfid: dfid,
          appid: '1014',
          platid: '4',
          encode_album_audio_id: songId,
          token: '714d199ee4813ecd5031ce9b2fece0a309bce9d258baff7e3c31bff27ed9f977',
          userid: userid,
          signature: signature
        },
        headers: {
          'User-Agent': this.config.userAgent || 'Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46'
        }
      });

      const responseTime = Date.now() - startTime;

      if (!response.data || response.data.status !== 1) {
        throw new Error(`Failed to get song info: ${response.data?.error || 'Unknown error'}`);
      }

      const songData = response.data.data;
      if (!songData) {
        throw new Error('No song data returned');
      }

      // 获取播放URL
      const urls = await this.getPlayUrls(songId, quality);
      
      // 获取歌词
      const lyric = await this.getLyric(songId);

      const song: SongInfo = {
        id: songId,
        name: songData.song_name || songData.audio_name || 'Unknown',
        artists: [songData.author_name || 'Unknown'],
        album: songData.album_name || '',
        duration: songData.timelength ? Math.floor(songData.timelength / 1000) : 0,
        platform: Platform.KUGOU,
        picUrl: songData.img || '',
        platformData: {
          hash: songId,
          album_id: songData.album_id,
          filesize: songData.filesize,
          bitrate: songData.bitrate
        }
      };

      const result: SongDetail = {
        status: 200,
        platform: Platform.KUGOU,
        song,
        urls,
        lyric,
        responseTime,
      };

      // 缓存结果
      await this.setToCache(cacheKey, result);
      
      logger.info(`Kugou song details retrieved: ${song.name} by ${song.artists.join(', ')}`);
      return result;

    } catch (error: any) {
      logger.error(`Kugou getSong failed for ${songId}:`, error);
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

      // 酷狗歌词接口
      const time = Date.now();
      const mid = this.generateMid();
      const dfid = mid;
      const userid = '0';

      // 构建签名参数
      const signParams = [
        this.SECRET_KEY,
        'appid=1014',
        `clienttime=${time}`,
        'clientver=20000',
        `dfid=${dfid}`,
        `encode_album_audio_id=${songId}`,
        `mid=${mid}`,
        'platid=4',
        'srcappid=2919',
        'token=714d199ee4813ecd5031ce9b2fece0a309bce9d258baff7e3c31bff27ed9f977',
        `userid=${userid}`,
        `uuid=${mid}`,
        this.SECRET_KEY,
      ];

      const signature = this.generateSignature(signParams);

      const response = await this.httpClient.get('https://wwwapi.kugou.com/play/songinfo', {
        params: {
          srcappid: '2919',
          clientver: '20000',
          clienttime: time,
          mid: mid,
          uuid: mid,
          dfid: dfid,
          appid: '1014',
          platid: '4',
          encode_album_audio_id: songId,
          token: '714d199ee4813ecd5031ce9b2fece0a309bce9d258baff7e3c31bff27ed9f977',
          userid: userid,
          signature: signature
        },
        headers: {
          'User-Agent': this.config.userAgent || 'Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46'
        }
      });

      if (!response.data || response.data.status !== 1) {
        throw new Error('Failed to get song info for lyrics');
      }

      const songData = response.data.data;
      if (!songData || !songData.lyrics) {
        throw new Error('No lyrics data available');
      }

      // 解析歌词
      const lyricText = songData.lyrics;
      const result: LyricData = {
        original: lyricText,
        timeline: this.parseLyricTimeline(lyricText),
      };

      // 缓存结果
      await this.setToCache(cacheKey, result);
      
      logger.info(`Kugou lyrics retrieved for song ${songId}`);
      return result;

    } catch (error: any) {
      logger.warn(`Kugou getLyric failed for song ${songId}:`, error);
      
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
  private async getPlayUrls(songId: string, quality: AudioQuality): Promise<AudioUrls> {
    const urls: AudioUrls = {};

    try {
      // 酷狗音乐播放URL获取API
      const response = await this.httpClient.get('http://trackercdn.kugou.com/i/v2/', {
        params: {
          key: this.generateKey(songId),
          hash: songId,
          br: 'hq',
          appid: 1005,
          pid: 2,
          cmd: 25,
          behavior: 'play',
        },
        headers: {
          'User-Agent': this.config.userAgent || 'Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46'
        }
      });

      if (response.data && response.data.status === 1 && response.data.url) {
        const playUrl = response.data.url[0];
        
        // 标准音质
        urls[AudioQuality.STANDARD] = {
          url: playUrl,
          bitrate: '128',
          format: 'mp3'
        };

        // 高音质 - 尝试获取更高质量的URL
        try {
          const hqResponse = await this.httpClient.get('http://trackercdn.kugou.com/i/v2/', {
            params: {
              key: this.generateKey(songId),
              hash: songId,
              br: 'hq',
              appid: 1005,
              pid: 2,
              cmd: 25,
              behavior: 'play',
            }
          });

          if (hqResponse.data && hqResponse.data.status === 1 && hqResponse.data.url) {
            urls[AudioQuality.HIGH] = {
              url: hqResponse.data.url[0],
              bitrate: '320',
              format: 'mp3'
            };
          }
        } catch (error) {
          // 如果高音质获取失败，使用标准音质
          urls[AudioQuality.HIGH] = urls[AudioQuality.STANDARD];
        }

        // 无损音质通常需要VIP，这里提供占位
        urls[AudioQuality.LOSSLESS] = {
          url: '',
          bitrate: '1411',
          format: 'flac'
        };
      }
    } catch (error) {
      logger.warn(`Failed to get play URLs for ${songId}:`, error);
    }

    return urls;
  }

  /**
   * 生成签名
   */
  private generateSignature(params: string[]): string {
    const signString = params.join('');
    return this.md5(signString);
  }

  /**
   * MD5 哈希函数
   */
  private md5(input: string): string {
    return crypto.createHash('md5').update(input, 'utf8').digest('hex');
  }

  /**
   * MID
   */
  private generateMid(): string {
    return '1twdCn2UqgJG1rSM9n3ZBuKa';
  }

  /**
   * 生成播放密钥
   */
  private generateKey(hash: string): string {
    const appid = '1005';
    const clientver = '8990';
    const mid = this.generateMid();
    const uuid = this.generateUuid();
    
    const data = `${hash}kgcloud${mid}${uuid}${appid}${clientver}`;
    return crypto.createHash('md5').update(data).digest('hex');
  }

  /**
   * 生成UUID
   */
  private generateUuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
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