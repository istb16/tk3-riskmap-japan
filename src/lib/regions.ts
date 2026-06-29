import type { Region } from './types';

export const REGIONS: Region[] = [
	// 北海道・東北
	{ id: 'hokkaido',  name: '北海道', lat: 43.0642, lng: 141.3469, city: 'Sapporo' },
	{ id: 'aomori',    name: '青森',   lat: 40.8246, lng: 140.7406, city: 'Aomori' },
	{ id: 'iwate',     name: '岩手',   lat: 39.7036, lng: 141.1527, city: 'Morioka' },
	{ id: 'miyagi',    name: '宮城',   lat: 38.2688, lng: 140.8721, city: 'Sendai' },
	{ id: 'akita',     name: '秋田',   lat: 39.7186, lng: 140.1023, city: 'Akita' },
	{ id: 'yamagata',  name: '山形',   lat: 38.2404, lng: 140.3636, city: 'Yamagata' },
	{ id: 'fukushima', name: '福島',   lat: 37.7603, lng: 140.4748, city: 'Fukushima' },
	// 関東
	{ id: 'ibaraki',   name: '茨城',   lat: 36.3416, lng: 140.4469, city: 'Mito' },
	{ id: 'tochigi',   name: '栃木',   lat: 36.5548, lng: 139.8836, city: 'Utsunomiya' },
	{ id: 'gunma',     name: '群馬',   lat: 36.3911, lng: 139.0608, city: 'Maebashi' },
	{ id: 'saitama',   name: '埼玉',   lat: 35.8617, lng: 139.6455, city: 'Saitama' },
	{ id: 'chiba',     name: '千葉',   lat: 35.6073, lng: 140.1062, city: 'Chiba' },
	{ id: 'tokyo',     name: '東京',   lat: 35.6895, lng: 139.6917, city: 'Tokyo' },
	{ id: 'kanagawa',  name: '神奈川', lat: 35.4437, lng: 139.6380, city: 'Yokohama' },
	// 中部
	{ id: 'niigata',   name: '新潟',   lat: 37.9026, lng: 139.0232, city: 'Niigata' },
	{ id: 'toyama',    name: '富山',   lat: 36.6953, lng: 137.2113, city: 'Toyama' },
	{ id: 'ishikawa',  name: '石川',   lat: 36.5944, lng: 136.6256, city: 'Kanazawa' },
	{ id: 'fukui',     name: '福井',   lat: 36.0652, lng: 136.2217, city: 'Fukui' },
	{ id: 'yamanashi', name: '山梨',   lat: 35.6635, lng: 138.5685, city: 'Kofu' },
	{ id: 'nagano',    name: '長野',   lat: 36.6486, lng: 138.1948, city: 'Nagano' },
	{ id: 'gifu',      name: '岐阜',   lat: 35.4232, lng: 136.7608, city: 'Gifu' },
	{ id: 'shizuoka',  name: '静岡',   lat: 34.9769, lng: 138.3831, city: 'Shizuoka' },
	{ id: 'aichi',     name: '愛知',   lat: 35.1815, lng: 136.9066, city: 'Nagoya' },
	{ id: 'mie',       name: '三重',   lat: 34.7303, lng: 136.5086, city: 'Tsu' },
	// 近畿
	{ id: 'shiga',     name: '滋賀',   lat: 35.0042, lng: 135.8685, city: 'Otsu' },
	{ id: 'kyoto',     name: '京都',   lat: 35.0116, lng: 135.7681, city: 'Kyoto' },
	{ id: 'osaka',     name: '大阪',   lat: 34.6937, lng: 135.5023, city: 'Osaka' },
	{ id: 'hyogo',     name: '兵庫',   lat: 34.6901, lng: 135.1956, city: 'Kobe' },
	{ id: 'nara',      name: '奈良',   lat: 34.6851, lng: 135.8050, city: 'Nara' },
	{ id: 'wakayama',  name: '和歌山', lat: 34.2304, lng: 135.1708, city: 'Wakayama' },
	// 中国
	{ id: 'tottori',   name: '鳥取',   lat: 35.5013, lng: 134.2351, city: 'Tottori' },
	{ id: 'shimane',   name: '島根',   lat: 35.4723, lng: 133.0505, city: 'Matsue' },
	{ id: 'okayama',   name: '岡山',   lat: 34.6551, lng: 133.9195, city: 'Okayama' },
	{ id: 'hiroshima', name: '広島',   lat: 34.3853, lng: 132.4553, city: 'Hiroshima' },
	{ id: 'yamaguchi', name: '山口',   lat: 34.1860, lng: 131.4706, city: 'Yamaguchi' },
	// 四国
	{ id: 'tokushima', name: '徳島',   lat: 34.0657, lng: 134.5592, city: 'Tokushima' },
	{ id: 'kagawa',    name: '香川',   lat: 34.3403, lng: 134.0433, city: 'Takamatsu' },
	{ id: 'ehime',     name: '愛媛',   lat: 33.8416, lng: 132.7657, city: 'Matsuyama' },
	{ id: 'kochi',     name: '高知',   lat: 33.5597, lng: 133.5311, city: 'Kochi' },
	// 九州・沖縄
	{ id: 'fukuoka',   name: '福岡',   lat: 33.5904, lng: 130.4017, city: 'Fukuoka' },
	{ id: 'saga',      name: '佐賀',   lat: 33.2494, lng: 130.2988, city: 'Saga' },
	{ id: 'nagasaki',  name: '長崎',   lat: 32.7503, lng: 129.8777, city: 'Nagasaki' },
	{ id: 'kumamoto',  name: '熊本',   lat: 32.7898, lng: 130.7417, city: 'Kumamoto' },
	{ id: 'oita',      name: '大分',   lat: 33.2382, lng: 131.6126, city: 'Oita' },
	{ id: 'miyazaki',  name: '宮崎',   lat: 31.9111, lng: 131.4239, city: 'Miyazaki' },
	{ id: 'kagoshima', name: '鹿児島', lat: 31.5602, lng: 130.5581, city: 'Kagoshima' },
	{ id: 'okinawa',   name: '沖縄',   lat: 26.2124, lng: 127.6809, city: 'Naha' },
];
