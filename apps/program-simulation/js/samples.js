// 例題。字下げは │ と └ で書く（空白でもよい）
window.SAMPLES = [
  {
    title: '合計を求める',
    code: `Data = [3, 8, 2, 7, 5]
goukei = 0
i を 0 から 要素数(Data) - 1 まで 1 ずつ増やしながら繰り返す:
└ goukei = goukei + Data[i]
表示する("合計は ", goukei)`,
  },
  {
    title: '最大値を求める',
    code: `Data = [3, 8, 2, 7, 5]
saidai = Data[0]
i を 1 から 要素数(Data) - 1 まで 1 ずつ増やしながら繰り返す:
│ もし Data[i] > saidai ならば:
└ └ saidai = Data[i]
表示する("最大値は ", saidai)`,
  },
  {
    title: '線形探索',
    code: `Data = [12, 5, 8, 21, 3]
mokuhyo = 21
basho = -1
i を 0 から 要素数(Data) - 1 まで 1 ずつ増やしながら繰り返す:
│ もし Data[i] == mokuhyo ならば:
└ └ basho = i
もし basho == -1 ならば:
│ 表示する("見つかりませんでした")
そうでなければ:
└ 表示する(mokuhyo, " は ", basho, " 番目にあります")`,
  },
  {
    title: '二分探索',
    code: `Data = [2, 5, 8, 12, 16, 23, 38, 56]
mokuhyo = 23
hidari = 0
migi = 要素数(Data) - 1
basho = -1
hidari <= migi and basho == -1 の間繰り返す:
│ naka = (hidari + migi) ÷ 2
│ もし Data[naka] == mokuhyo ならば:
│ │ basho = naka
│ そうでなくもし Data[naka] < mokuhyo ならば:
│ │ hidari = naka + 1
│ そうでなければ:
└ └ migi = naka - 1
表示する("見つかった場所: ", basho)`,
  },
  {
    title: 'バブルソート（並べかえ）',
    code: `Data = [5, 3, 8, 1, 4]
n = 要素数(Data)
i を 0 から n - 2 まで 1 ずつ増やしながら繰り返す:
│ j を 0 から n - 2 - i まで 1 ずつ増やしながら繰り返す:
│ │ もし Data[j] > Data[j + 1] ならば:
│ │ │ tmp = Data[j]
│ │ │ Data[j] = Data[j + 1]
└ └ └ Data[j + 1] = tmp
表示する(Data)`,
  },
  {
    title: '10進数を2進数にする',
    code: `kazu = 13
kekka = ""
kazu > 0 の間繰り返す:
│ amari = kazu % 2
│ kekka = 文字列(amari) + kekka
└ kazu = kazu ÷ 2
表示する("2進数で ", kekka)`,
  },
  {
    title: '100 を超えるまで足す',
    code: `# 1, 2, 3, … と足していき、合計が 100 を超えたら止める
goukei = 0
n = 0
繰り返す:
│ n = n + 1
└ goukei = goukei + n
を, goukei > 100 になるまで実行する
表示する(n, " まで足すと ", goukei)`,
  },
  {
    title: '数を数える（度数）',
    code: `Tokuten = [3, 1, 4, 1, 5, 2, 3, 3]
Hindo のすべての要素を 0 にする
i を 0 から 要素数(Tokuten) - 1 まで 1 ずつ増やしながら繰り返す:
│ ten = Tokuten[i]
└ Hindo[ten] = Hindo[ten] + 1
表示する(Hindo)`,
  },
  {
    title: '2次元配列の合計',
    code: `Hyo = [[1, 2, 3], [4, 5, 6]]
goukei = 0
i を 0 から 1 まで 1 ずつ増やしながら繰り返す:
│ j を 0 から 2 まで 1 ずつ増やしながら繰り返す:
└ └ goukei = goukei + Hyo[i][j]
表示する("合計は ", goukei)`,
  },
];
