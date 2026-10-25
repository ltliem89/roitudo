/**
 * EquipmentInfo.ts
 * Thông tin khoa học chi tiết của 7 bộ phận trong bộ thí nghiệm Bài 11 (SGK Vật lí 10 - Kết nối tri thức)
 * Dùng cho chế độ Cận cảnh thiết bị, Hướng dẫn học tập và Nhãn tên thiết bị 3D.
 */

export type EquipmentId =
  | 'PLUMB_CHANNEL'
  | 'STEEL_CYLINDER'
  | 'ELECTROMAGNET'
  | 'PHOTOGATE'
  | 'TRIPOD_STAND'
  | 'DIGITAL_TIMER'
  | 'RELEASE_SWITCH';

export type CameraPresetId =
  | 'OVERVIEW'
  | 'MEASUREMENT_ANGLE'
  | 'CLOSEUP_MAGNET'
  | 'CLOSEUP_PHOTOGATE'
  | 'CLOSEUP_TIMER'
  | 'CLOSEUP_SWITCH';

export interface EquipmentDetail {
  id: EquipmentId;
  sgkNumber: number;
  name: string;
  shortLabel: string;
  roleSummary: string;
  scientificPrinciple: string;
  validInteractions: string[];
  cameraPreset: CameraPresetId;
  worldAnchor: [number, number, number];
}

export const EQUIPMENT_CATALOG: Record<EquipmentId, EquipmentDetail> = {
  PLUMB_CHANNEL: {
    id: 'PLUMB_CHANNEL',
    sgkNumber: 1,
    name: 'Máng đứng có gắn dây dọi (1)',
    shortLabel: '(1) Máng đứng & Dây dọi',
    roleSummary: 'Dùng làm chuẩn căn chỉnh phương thẳng đứng cho giá đỡ và đường rơi của trụ thép.',
    scientificPrinciple:
      'Quả dọi chịu tác dụng của trọng lực và lực căng dây nên khi cân bằng, dây dọi luôn định hướng trùng với phương thẳng đứng của gia tốc trọng trường g tại nơi làm thí nghiệm. Chỉnh 3 vít chân đế sao cho mũi quả dọi trùng tâm vòng chuẩn giúp đường rơi của trụ thép đi thẳng qua tâm cổng quang điện mà không va quệt.',
    validInteractions: [
      'Quan sát dây dọi và quả dọi đồng đối chiếu với trục rơi',
      'Kiểm tra độ lệch ngang của cổng quang điện so với phương dây dọi',
    ],
    cameraPreset: 'MEASUREMENT_ANGLE',
    worldAnchor: [-0.085, 0.55, 0.0],
  },
  STEEL_CYLINDER: {
    id: 'STEEL_CYLINDER',
    sgkNumber: 2,
    name: 'Vật bằng thép hình trụ — Trụ thép (2)',
    shortLabel: '(2) Trụ thép hình trụ',
    roleSummary: 'Vật nặng bằng thép sắt từ có hai đáy phẳng dùng làm vật rơi tự do.',
    scientificPrinciple:
      'Trụ thép có khối lượng riêng lớn và tiết diện nhỏ giúp giảm thiểu sức cản không khí so với trọng lực (F_c << P). Hai mặt đáy phẳng giúp tiếp xúc ổn định với lõi nam châm điện và tạo mép chắn tia hồng ngoại sắc nét khi đi qua cổng quang điện.',
    validInteractions: [
      'Nhấn trực tiếp vào trụ thép hoặc nút "Đặt lại trụ thép" để đưa trụ lên đầu nam châm điện',
      'Bật chế độ Giải thích khoa học để xem ảnh chụp hoạt nghiệm s(t) = ½gt² khi rơi',
    ],
    cameraPreset: 'CLOSEUP_MAGNET',
    worldAnchor: [0.0, 0.914, 0.06],
  },
  ELECTROMAGNET: {
    id: 'ELECTROMAGNET',
    sgkNumber: 3,
    name: 'Nam châm điện (3)',
    shortLabel: '(3) Nam châm điện',
    roleSummary: 'Giữ trụ thép đứng yên ở vị trí ban đầu và thả rơi không vận tốc đầu (v₀ = 0) khi ngắt dòng.',
    scientificPrinciple:
      'Khi có dòng điện một chiều chạy qua cuộn dây, lõi sắt non bị từ hóa hút chặt trụ thép. Khi công tắc kép ngắt dòng điện, từ trường triệt tiêu ngay lập tức giúp trụ thép bắt đầu rơi tự do với vận tốc ban đầu v₀ = 0 mà không bị tác dụng xung lực ngang như khi thả bằng tay.',
    validInteractions: [
      'Nhấn vào nam châm điện để gắn lại trụ thép hoặc xem cận cảnh cuộn dây - lõi sắt',
      'Điều khiển dòng qua nam châm bằng công tắc kép (7)',
    ],
    cameraPreset: 'CLOSEUP_MAGNET',
    worldAnchor: [0.0, 0.965, 0.06],
  },
  PHOTOGATE: {
    id: 'PHOTOGATE',
    sgkNumber: 4,
    name: 'Cổng quang điện (4)',
    shortLabel: '(4) Cổng quang điện',
    roleSummary: 'Cảm biến quang học chữ U phát hiện thời điểm trụ thép đi qua để dừng đồng hồ hiện số.',
    scientificPrinciple:
      'Một nhánh chữ U chứa điốt phát tia hồng ngoại (IR LED), nhánh đối diện chứa phototransistor thu tia. Khi mặt đáy trụ thép đi qua và chắn chùm tia hồng ngoại, trạng thái điện áp thay đổi đột ngột gửi xung dừng (STOP) về đồng hồ đo thời gian. Nếu cổng bị lệch khỏi đường rơi, trụ thép không chắn tia và đồng hồ không dừng.',
    validInteractions: [
      'Kéo trực tiếp kẹp cổng quang điện dọc theo trụ đứng để thay đổi quãng đường s (0.10 m – 0.80 m)',
      'Dùng nút +/- 1 cm, +/- 1 mm hoặc nhập số s chính xác',
      'Thử nghiệm chỉnh độ lệch ngang hoặc rút dây cổng quang để quan sát lỗi thực nghiệm',
    ],
    cameraPreset: 'CLOSEUP_PHOTOGATE',
    worldAnchor: [0.0, 0.4, 0.06],
  },
  TRIPOD_STAND: {
    id: 'TRIPOD_STAND',
    sgkNumber: 5,
    name: 'Giá đỡ đế ba chân, trụ thép, thước và kẹp (5)',
    shortLabel: '(5) Giá đỡ & Thước đo',
    roleSummary: 'Hệ khung cơ khí giữ nam châm điện, cổng quang điện và thước đo quãng đường s.',
    scientificPrinciple:
      'Đế gang 3 chân có 3 vít chỉnh cân bằng giúp toàn bộ trục giá đỡ đứng vững. Thước milimet gắn song song với trụ cho phép xác định chính xác quãng đường rơi s tính từ mặt đáy thấp nhất của trụ thép tại vị trí thả (mốc 0) đến mặt phẳng tia quang điện.',
    validInteractions: [
      'Quan sát trực tiếp hai mốc đo quãng đường s trên thước chia mm/cm',
      'Chạm vào thước hoặc kẹp để chuyển góc nhìn đo chính diện (Góc đo)',
    ],
    cameraPreset: 'MEASUREMENT_ANGLE',
    worldAnchor: [0.0, 0.48, 0.0],
  },
  DIGITAL_TIMER: {
    id: 'DIGITAL_TIMER',
    sgkNumber: 6,
    name: 'Đồng hồ đo thời gian hiện số (6)',
    shortLabel: '(6) Đồng hồ hiện số',
    roleSummary: 'Đo khoảng thời gian rơi t từ lúc ngắt điện nam châm đến khi trụ thép chắn tia cổng quang.',
    scientificPrinciple:
      'Sử dụng bộ dao động thạch anh tần số cao để đếm thời gian với độ chia nhỏ nhất 0,001 s (thang 9,999 s) hoặc 0,01 s (thang 99,99 s). Đồng hồ bắt đầu đếm ngay khi công tắc kép ngắt mạch giữ nam châm điện và dừng đếm ngay khi nhận xung chắn tia từ cổng quang điện.',
    validInteractions: [
      'Nhấn trực tiếp nút POWER, RESET, MODE trên mặt đồng hồ 3D hoặc thanh điều khiển',
      'Chuyển đổi cấu hình sơ đồ cắm dây: "Theo quy trình SGK" hoặc "Biến thể C3-MC964"',
    ],
    cameraPreset: 'CLOSEUP_TIMER',
    worldAnchor: [0.34, 0.12, 0.08],
  },
  RELEASE_SWITCH: {
    id: 'RELEASE_SWITCH',
    sgkNumber: 7,
    name: 'Công tắc kép điều khiển nhả trụ thép (7)',
    shortLabel: '(7) Công tắc kép',
    roleSummary: 'Đồng thời ngắt dòng điện nuôi nam châm điện và phát tín hiệu bắt đầu đếm thời gian (START).',
    scientificPrinciple:
      'Công tắc kép đảm bảo sự đồng bộ giữa thời điểm ngắt dòng điện giữ trụ thép và thời điểm kích hoạt bộ đếm của đồng hồ hiện số, giảm thiểu sai số trễ phản xạ của người làm thí nghiệm.',
    validInteractions: [
      'Nhấn trực tiếp vào công tắc kép trong cảnh 3D hoặc nút "Nhả trụ thép" để thả vật',
    ],
    cameraPreset: 'CLOSEUP_SWITCH',
    worldAnchor: [-0.26, 0.06, 0.16],
  },
};

export interface PostLabQuestion {
  id: number;
  question: string;
  hint: string;
  standardAnswer: string;
}

export const POST_LAB_QUESTIONS: PostLabQuestion[] = [
  {
    id: 1,
    question: '1. Vì sao nên dùng cùng một trụ thép trong các lần đo?',
    hint: 'Xem xét kích thước hình học, khối lượng và đặc tính từ của vật rơi.',
    standardAnswer:
      'Dùng cùng một trụ thép đảm bảo kích thước (chiều cao, đường kính), khối lượng, độ từ dư tại mặt tiếp xúc với nam châm điện và hệ số cản không khí không đổi giữa các lần đo, giúp mốc đo quãng đường s (từ mặt đáy trụ thép) hoàn toàn nhất quán.',
  },
  {
    id: 2,
    question: '2. Vì sao phải căn chỉnh cổng quang điện thẳng hàng với đường rơi (theo phương dây dọi)?',
    hint: 'Cổng quang điện phát hiện vật bằng nguyên lí nào?',
    standardAnswer:
      'Cổng quang điện hoạt động nhờ chùm tia hồng ngoại nối giữa mắt phát và mắt thu. Nếu cổng lệch khỏi phương dây dọi, trụ thép có thể rơi sượt ngoài tia hồng ngoại (đồng hồ không dừng) hoặc va đập cơ học vào vỏ cổng quang gây hỏng thiết bị và sai lệch kết quả.',
  },
  {
    id: 3,
    question: '3. Vì sao thời gian rơi t tăng khi quãng đường s tăng, nhưng không tăng tỉ lệ bậc nhất theo s?',
    hint: 'Dựa vào công thức liên hệ giữa s và t trong chuyển động thẳng nhanh dần đều không vận tốc đầu.',
    standardAnswer:
      'Vì rơi tự do là chuyển động thẳng nhanh dần đều với vận tốc tăng dần v = gt (chứ không phải chuyển động đều). Từ s = ½gt² suy ra t = √(2s/g), nghĩa là thời gian rơi tỉ lệ thuận với căn bậc hai của quãng đường s.',
  },
  {
    id: 4,
    question: '4. Đồ thị s theo t² có dạng đường gì và hệ số góc của nó cho biết đại lượng nào?',
    hint: 'So sánh phương trình s = (g/2)·t² với phương trình đường thẳng y = k·x.',
    standardAnswer:
      'Đồ thị s theo t² là một đường thẳng đi qua (hoặc gần qua) gốc tọa độ. Hệ số góc của đường thẳng là k = Δs / Δ(t²) = g/2, từ đó xác định được gia tốc rơi tự do g = 2k.',
  },
  {
    id: 5,
    question: '5. Nêu các nguồn gây sai số chủ yếu trong thí nghiệm thực tế.',
    hint: 'Chú ý hiện tượng từ dư ở lõi nam châm điện, phép đọc thước đo và lực cản không khí.',
    standardAnswer:
      'Các nguồn sai số thực tế gồm: (1) Từ dư của lõi sắt nam châm điện làm trụ thép rời chậm hơn một khoảng thời gian rất nhỏ sau khi ngắt công tắc; (2) Sai số đọc vị trí thước đo quãng đường s và độ dày chùm tia quang điện; (3) Lực cản của không khí khi vận tốc rơi lớn; (4) Độ chia nhỏ nhất của đồng hồ hiện số.',
  },
  {
    id: 6,
    question: '6. Mô phỏng lí tưởng khác với thiết bị thực nghiệm thật ở những điểm nào?',
    hint: 'So sánh chế độ "Lí tưởng" và chế độ "Thực nghiệm có sai số" trong phần Cài đặt.',
    standardAnswer:
      'Trong mô phỏng lí tưởng: không có lực cản không khí, từ trường nam châm triệt tiêu tức thời (không có trễ từ dư), tia quang điện mảnh lí tưởng và không có nhiễu điện tử, nên t = √(2s/g) lặp lại tuyệt đối. Ở thiết bị thật luôn có độ phân tán nhỏ giữa các lần đo tại cùng một quãng đường s.',
  },
];
