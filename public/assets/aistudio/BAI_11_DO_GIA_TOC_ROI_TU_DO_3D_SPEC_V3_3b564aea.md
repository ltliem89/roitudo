# BÀI 11 — THỰC HÀNH ĐO GIA TỐC RƠI TỰ DO
## Đặc tả mô phỏng phòng thí nghiệm 3D tương tác — Gemini 4 Argon / Google AI Studio

**Tên file:** `BAI_11_DO_GIA_TOC_ROI_TU_DO_3D_SPEC_V3.md`  
**Phiên bản:** 3.0 — bổ sung tiêu chí hiển thị điện thoại trực quan, sắc nét độ phân giải cao  
**Ngôn ngữ:** Tiếng Việt  
**Đối tượng:** Học sinh theo bài thực hành trong ảnh SGK  
**Nền tảng đích:** Web responsive, ưu tiên Safari trên iPhone, Android và máy tính  
**Đồ họa đề xuất:** React + TypeScript + Three.js, nếu tương thích với môi trường AI Studio hiện tại

---

## 1. Mục tiêu

Xây dựng phòng thí nghiệm ảo 3D để học sinh đo gia tốc rơi tự do của trụ thép hình trụ bằng giá đỡ, nam châm điện giữ/thả trụ thép, cổng quang điện, đồng hồ đo thời gian hiện số, công tắc, dây nối và thước đo khoảng cách.

Đây phải là mô phỏng tương tác thực sự, không phải ảnh 3D tĩnh hoặc video. Học sinh có thể:
1. Quan sát toàn bộ bộ dụng cụ và phóng to từng thiết bị.
2. Điều chỉnh vị trí cổng quang điện trên trụ.
3. Chọn quãng đường rơi \(s\).
4. Cấp điện để nam châm điện giữ trụ thép và reset đồng hồ.
5. Ngắt dòng điện nam châm điện để thả trụ thép và bắt đầu đo.
6. Để bi đi qua cổng quang điện, làm đồng hồ dừng và hiện thời gian.
7. Lặp lại phép đo cho \(s_1, s_2, s_3, s_4, s_5\), tối đa 5 lần mỗi quãng đường.
8. Ghi bảng số liệu, tính \(t^2\), tính \(g\), giá trị trung bình và độ phân tán theo phương pháp được chọn.
9. Vẽ đồ thị \(s\) theo \(t^2\), quan sát quan hệ tuyến tính và rút ra kết luận.

**Thứ tự ưu tiên:** đúng nguyên lí đo → logic thiết bị → tương tác cảm ứng → bố cục điện thoại → đồ họa đẹp và hiệu ứng.


> **Đính chính quan trọng so với bản nháp trước:** SGK mô tả **trụ thép hình trụ**, không phải viên bi hình cầu. Bộ phận số (1) là **máng đứng có gắn dây dọi**, không phải máng dẫn dây điện. Sơ đồ jack đồng hồ phải được cấu hình theo đúng phiên bản thiết bị, vì tài liệu công khai về các biến thể MC964/C3-MC964 có mô tả cổng kết nối khác nhau.



---

## 2. Phân tích hình SGK và giới hạn thông tin

Ảnh SGK thể hiện bộ dụng cụ có các thành phần:
1. Máng đứng có gắn dây dọi (dùng làm chuẩn căn chỉnh phương thẳng đứng).
2. Vật bằng thép hình trụ (trụ thép).
3. Nam châm điện dùng để giữ và thả vật thép.
4. Công tắc.
5. Giá đỡ có đế ba chân, trụ thép, kẹp và vít chỉnh.
6. Đồng hồ đo thời gian hiện số.
7. Công tắc kép.

Ảnh không cho biết mã thiết bị, thông số điện, độ phân giải thực hoặc sơ đồ chân đầy đủ. Vì vậy, dựng một bộ thiết bị giáo dục điển hình gần với bố cục SGK; **không bịa model, điện áp, thông số chính xác hoặc logo của nhà sản xuất**.

### Logic đo mặc định

- Nam châm điện giữ trụ thép ở vị trí ban đầu.
- Cổng quang điện được đặt phía dưới, thẳng hàng với đường rơi.
- Đồng hồ nối với mạch nhả trụ thép và cổng quang điện.
- Khi ngắt dòng điện nam châm điện, trụ thép được nhả và đồng hồ bắt đầu đo.
- Khi trụ thép chắn tia quang điện, đồng hồ dừng.
- Di chuyển cổng quang điện để tạo các quãng đường khác nhau và đo lặp lại.

**Điểm khoa học bắt buộc:** cổng quang điện phát hiện trụ thép khi trụ thép chắn tia sáng (thường là hồng ngoại). Nó không phải công tắc cơ học để trụ thép va vào. Nếu cổng lệch khỏi đường rơi, đồng hồ không được dừng chỉ vì trụ thép đi ngang gần cảm biến.

Nếu thiết bị thực tế có kiểu vận hành khác, cho phép cấu hình chế độ thiết bị và ghi rõ giả định đang sử dụng.

### Lưu ý đặc biệt về đồng hồ MC964 và sơ đồ cắm dây

Trong ảnh SGK, hướng dẫn thực hành ghi nam châm điện vào ổ A và cổng quang điện vào ổ B ở mặt sau đồng hồ, sau đó chọn MODE thích hợp. Tuy nhiên, tài liệu công khai cho một biến thể đồng hồ **C3-MC964** mô tả A/B là các đầu nối cổng quang và C là đầu cấp nguồn cho nam châm điện. Đây có thể là khác biệt phiên bản/thiết bị hoặc khác biệt tài liệu; không được giả định mọi đồng hồ mang tên MC964 có cùng sơ đồ chân.

Vì vậy:
- Tách mô hình logic đo khỏi phần hiển thị cổng kết nối.
- Cung cấp cấu hình **“Theo quy trình SGK”** và cho phép thay đổi sơ đồ chân theo model thật.
- Chỉ vẽ chữ A/B/C và đường cắm dây theo đúng cấu hình đang chọn.
- Trong cấu hình SGK, logic đo phải phản ánh quy trình: RESET → ngắt điện nam châm/nhả trụ → bắt đầu đo → trụ chắn tia quang điện → kết thúc đo.
- Không tự gán một chế độ MODE cụ thể cho mọi phiên bản. Hiển thị “MODE theo sơ đồ thiết bị đang chọn” và ghi chú rằng giáo viên cần đối chiếu nhãn phía sau đồng hồ thật.
- Với biến thể C3-MC964 được tài liệu nhà cung cấp mô tả, có hai thang 9,999 s (độ chia nhỏ nhất 0,001 s) và 99,99 s (0,01 s), các chế độ A, B, A+B, A↔B và T; chỉ dùng các chi tiết này khi chọn đúng biến thể thiết bị đó.

Nguồn đối chiếu:
- SGK Vật lí 10, Kết nối tri thức, Bài 11 — quy trình trong ảnh người dùng cung cấp.
- DMK Lab, “Giới thiệu Đồng hồ đo thời gian hiện số”, model C3-MC964: https://dmklab.vn/dong-ho-do-thoi-gian-hien-so/


---

## 3. Mô hình khoa học

### 3.1. Rơi tự do lí tưởng

Với vật được thả từ trạng thái nghỉ, bỏ qua lực cản không khí và coi gia tốc trọng trường không đổi:

\[
s=\frac{1}{2}gt^2,\qquad t=\sqrt{\frac{2s}{g}},\qquad g=\frac{2s}{t^2}
\]

Trong đó \(s\) là quãng đường rơi (m), \(t\) là thời gian (s), \(g\) là gia tốc rơi tự do (m/s²).

Đồ thị mặc định:
- Trục hoành: \(t^2\) (s²).
- Trục tung: \(s\) (m).
- Với mô hình lí tưởng, hệ số góc \(k=g/2\), do đó \(g=2k\).

Không nhầm với đồ thị \(t^2\) theo \(s\), vốn có hệ số góc \(2/g\).

### 3.2. Giá trị mặc định và sai số

- Giá trị mặc định minh họa: \(g=9{,}81\ \mathrm{m/s^2}\).
- Cho phép giáo viên chỉnh \(g\) trong cài đặt nâng cao.
- Không ép kết quả đo của học sinh luôn bằng 9,81; số liệu phải được sinh từ thời gian mô phỏng.
- Có hai chế độ: **Lí tưởng** (không thêm nhiễu) và **Thực nghiệm có sai số** (độ phân giải/sai số nhỏ, được mô tả rõ và có thể tái lập).
- Độ phân giải màn hình mặc định có thể là 0,001 s, nhưng phải ghi đây là lựa chọn hiển thị mô phỏng, không phải thông số đã xác nhận của thiết bị trong ảnh.
- Không tuyên bố độ chính xác mô phỏng bằng thiết bị thật nếu chưa hiệu chuẩn.

### 3.3. Hoạt ảnh rơi

Dùng cùng một mô hình cho vị trí trụ thép, đồng hồ và dữ liệu:
\[
s(t)=\frac12gt^2,\qquad v(t)=gt
\]

Trụ thép phải rơi nhanh dần đều, không chuyển động với tốc độ không đổi. Đồng hồ bắt đầu đúng sự kiện nhả trụ thép và dừng đúng lúc trụ thép chắn tia quang điện. Định nghĩa điểm đo quãng đường phải nhất quán; mặc định đo từ mặt đáy thấp nhất của trụ thép tại vị trí thả đến mặt phẳng tia quang điện, và hiển thị rõ hai mốc.

### 3.4. Xử lí dữ liệu

Với \(n\) lần đo tại một quãng đường:
\[
\bar t=\frac{1}{n}\sum_{j=1}^{n}t_j
\]
Có thể tính từng \(g_j=2s/t_j^2\) rồi lấy trung bình \(\bar g\). Không đánh đồng \(\frac{2s}{\bar t^2}\) với trung bình các \(g_j\); chúng không nhất thiết bằng nhau. Cho phép giáo viên chọn cách xử lí và hiển thị công thức đang dùng.

Bảng gồm \(s_1...s_5\), mỗi mức tối đa 5 lần đo. Không tự điền số liệu trước khi học sinh thực hành. Không tự gán ý nghĩa duy nhất cho \(\Delta g\) nếu chưa nêu cách tính; dùng tooltip giải thích phương pháp thống kê được chọn.

---

## 4. Thiết kế vật thể 3D chi tiết, đúng chức năng

Mục tiêu thẩm mỹ là chất lượng như game FPS hiện đại, nhưng độ trung thực của dụng cụ, khả năng quan sát và chức năng khoa học phải được ưu tiên hơn hiệu ứng điện ảnh.

### 4.1. Giá đỡ
- Đế nặng ba chân/ba điểm tiếp xúc, trụ thép thẳng đứng.
- Kẹp trượt trên trụ, có vít/núm siết nhìn thấy được.
- Cổng quang điện và cụm nam châm điện gắn vào kẹp đúng vị trí.
- Kẹp chỉ trượt dọc trụ; không bay tự do.
- Thước chia đặt song song trụ, giá trị đồng bộ với vị trí cổng.
- Không để các bộ phận xuyên nhau.

### 4.2. Nam châm điện
- Cụm trụ/vỏ kim loại ở đầu trên, có đầu giữ trụ thép và dây điện gắn đúng cọc.
- Có thể thể hiện cuộn dây/lõi sắt ở chế độ cận cảnh; không cần phơi toàn bộ cấu tạo nếu thiết bị thực tế có vỏ kín.
- Khi có dòng điện, trụ thép được giữ.
- Khi công tắc ngắt dòng, lực giữ mất đi trong mô hình và bi bắt đầu rơi.
- Không cho trụ thép rơi khi nam châm vẫn đang giữ, trừ khi người dùng thực hiện thao tác hợp lệ.

### 4.3. Trụ thép hình trụ

- Dựng đúng **vật bằng thép hình trụ** theo SGK; không thay bằng quả cầu.
- Hình trụ kim loại có hai mặt đáy phẳng, cạnh hơi bo/vát nhẹ và vật liệu thép đánh bóng vừa phải.
- Kích thước phải hợp lí so với cực nam châm điện và khe cổng quang điện.
- Khi được giữ, một mặt đầu tiếp xúc ổn định với đầu nam châm điện.
- Khi ngắt dòng điện giữ, trụ bắt đầu rơi dọc theo phương thẳng đứng; không tự trôi ngang hoặc xoay vô cớ.
- Máng đứng và dây dọi dùng làm chuẩn bố trí/căn chỉnh; không được vô tình biến thí nghiệm thành chuyển động trượt có ma sát đáng kể.
- Trụ dừng tại khay/điểm hứng an toàn ở cuối hành trình. Nút đặt lại đưa trụ về đầu nam châm điện sau khi phép đo hoàn tất.
- Trong chế độ giải thích, có thể bật đường biểu diễn quỹ đạo; mặc định tắt để giữ hình ảnh thực tế.

### 4.4. Cổng quang điện
- Dạng chữ U/khung có hai nhánh đối diện, tạo khe cho bi đi qua.
- Một nhánh phát tia, nhánh kia thu tia; chỉ hiển thị tia đỏ mờ trong chế độ giải thích, vì tia hồng ngoại thực tế không nhìn thấy bằng mắt thường.
- Gắn trên kẹp trượt theo trụ.
- trụ thép chắn tia → phát sự kiện dừng đồng hồ.
- Tia được thông lại → cảm biến trở về trạng thái chờ.
- Nếu cổng lệch khỏi đường rơi, bi không chắn tia và đồng hồ không dừng.
- Có điều chỉnh lệch ngang nhỏ để minh họa lỗi căn chỉnh.

### 4.5. Đồng hồ đo thời gian hiện số
- Hộp thiết bị riêng, vỏ công nghiệp, màn hình LED/LCD số rõ ràng.
- Có nút `MODE`, `RESET`, đèn/trạng thái sẵn sàng.
- Trạng thái màn hình:
  - `00.000 s` sau reset.
  - `READY`/biểu tượng chờ khi đã sẵn sàng.
  - Đếm thời gian sau sự kiện nhả bi.
  - Dừng và giữ số đo khi trụ thép chắn tia.
  - Báo lỗi rõ ràng khi chưa reset, cảm biến không nối hoặc bi không được nhả.
- Không hiển thị kết quả cuối trước sự kiện dừng.
- Không khẳng định màn hình/độ phân giải này là bản sao của một model cụ thể.

### 4.6. Công tắc và dây nối
- Công tắc có trạng thái ON/OFF nhìn thấy được và hoạt ảnh gạt ngắn.
- Công tắc điều khiển mạch nam châm điện, không trực tiếp đặt vị trí bi.
- Dây nối kết thúc đúng tại cọc; không lơ lửng hoặc xuyên qua thiết bị.
- Màu dây chỉ là mã trực quan, không khẳng định là chuẩn điện áp phổ quát.
- Hạt sáng biểu diễn dòng điện chỉ có trong chế độ giải thích, không coi là hiện tượng ánh sáng thực trên dây.

### 4.7. Thước và khoảng cách
- Thước có vạch chia đều, đơn vị m/cm.
- \(s\) đo từ vị trí đầu đã quy ước đến mặt phẳng tia quang điện.
- Khi di chuyển cổng, số đo \(s\) cập nhật tức thời.
- Hiển thị hai mốc đo trực quan; không đo từ chân đế hay mốc không liên quan.

---

## 5. Logic vận hành và trạng thái thiết bị

Dùng state machine, tối thiểu:
`POWER_OFF` → `SETUP` → `BALL_HELD` → `READY_TO_DROP` → `FALLING_TIMER_RUNNING` → `PHOTOGATE_TRIGGERED` → `MEASUREMENT_COMPLETE`, kèm trạng thái `ERROR`.

### Một lần đo chuẩn
1. Bật nguồn và kiểm tra kết nối.
2. Đưa bi tiếp xúc đầu nam châm điện.
3. Căn chỉnh cổng quang trên đường rơi.
4. Chọn \(s\) bằng cách dịch cổng.
5. Nhấn `RESET`; đồng hồ về 0 và sẵn sàng.
6. Gạt công tắc ngắt dòng nam châm điện.
7. trụ thép được thả và đồng hồ bắt đầu cùng sự kiện theo quy ước mô phỏng.
8. trụ thép rơi nhanh dần đều.
9. trụ thép chắn tia quang điện; đồng hồ dừng và giữ \(t\).
10. Nhấn `Ghi kết quả` để lưu \(s,t,t^2,g\).
11. Đưa bi về vị trí đầu cho lần tiếp theo. Không tự xóa dữ liệu đã ghi.

### Xử lí lỗi
- Chưa reset: không bắt đầu đo, hướng dẫn reset.
- Bi chưa được nam châm giữ: nút nhả bi không chạy phép đo.
- Cổng quang không nối: trụ thép rơi nhưng đồng hồ không dừng; báo lỗi khi trụ thép tới khay.
- Cổng lệch đường rơi: đồng hồ tiếp tục chạy, thông báo căn chỉnh.
- Reset khi bi đang rơi: xác nhận hủy lần đo hoặc dừng và đánh dấu lần đo bị hủy.
- Nút đặt lại không xóa bảng số liệu; có nút xóa bảng riêng với xác nhận.
- Không tạo số đo giả nếu sự kiện vật lí chưa diễn ra.

---

## 6. Giao diện: tối đa hóa diện tích mô phỏng

### 6.1. Bố cục
- Canvas 3D là trung tâm, chiếm khoảng 70–85% chiều cao khả dụng khi panel thu gọn.
- Thanh trên gọn: tên bài, trợ giúp, nút mở rộng.
- Thanh điều khiển chính ở cạnh dưới: `Nguồn`, `Reset đồng hồ`, `Nhả bi`, `Đặt lại bi`, `Ghi kết quả`.
- Panel bảng số liệu, đồ thị, thông số, giải thích và cài đặt có thể mở/đóng độc lập.
- Có nút `Ẩn giao diện` để ẩn thanh công cụ, chỉ giữ cảnh 3D và một nút nổi nhỏ để gọi giao diện trở lại.
- Ẩn/hiện panel không được reset trạng thái thí nghiệm.
- Không để panel mặc định che trụ thép, cổng quang hoặc đồng hồ.

### 6.2. Panel có thể bật/tắt
1. Điều khiển thiết bị.
2. Thông số đo \(s,t,t^2,g\).
3. Bảng số liệu 5 mức × 5 lần đo.
4. Đồ thị \(s\) theo \(t^2\).
5. Giải thích khoa học.
6. Nhãn tên thiết bị.
7. Điều khiển camera.
8. Cài đặt mô hình và sai số.

### 6.3. Cảm ứng và camera
- Chế độ riêng `Chỉnh thiết bị` / `Xoay camera` để tránh xung đột.
- Một ngón kéo kẹp khi chạm tay nắm; kéo vùng trống để xoay camera.
- Chụm hai ngón zoom; nút khôi phục góc nhìn.
- Dùng pointer events cho chuột/cảm ứng; không phụ thuộc hover.
- Nút đủ lớn để chạm (mục tiêu tối thiểu khoảng 44×44 CSS px).
- Có nút tăng/giảm vị trí và nhập số \(s\) như phương án chính xác thay cho kéo nhỏ.

### 6.4. Cận cảnh thiết bị
Chạm thiết bị để xem tên, chức năng, trạng thái và các điều khiển hợp lệ. Chuyển camera không làm dừng đồng hồ hoặc thay đổi vật lí.

---

## 7. Đồ họa cao cấp kiểu game FPS

- Phòng thí nghiệm gọn, sạch, ánh sáng có chiều sâu; bàn trung tính.
- Vật liệu PBR: thép xước cho trụ/kẹp, thép bóng vừa phải cho trụ thép, nhựa nhám cho đồng hồ, cao su cho chân đế, kim loại/nhựa cách điện cho đầu nối.
- Ánh sáng key/fill/rim nhẹ; bóng mềm nếu thiết bị hỗ trợ.
- Ambient occlusion nhẹ hoặc kỹ thuật thay thế tiết kiệm.
- Không dùng bloom mạnh làm mờ màn hình số; hạn chế DOF và motion blur.
- Nhãn và số liệu quan trọng phải là UI sắc nét, không phải texture chữ nhỏ trên mô hình.
- Các vít, kẹp, cọc điện, dây, màn hình, nút bấm và khe cổng quang phải có vị trí hợp lí.
- Không thêm linh kiện giả chỉ để thiết bị trông phức tạp.
- Camera mặc định góc 3/4 thấy trọn bộ dụng cụ; có `Overview`, `Cận cảnh thiết bị`, `Góc đo` và `Khôi phục góc nhìn`.
- Không cắt mất đầu nam châm, trụ thép hoặc chân đế khi đổi kích thước màn hình.
- Có LOD và giảm bóng/độ phân giải trên điện thoại yếu.
- Mục tiêu là đẹp như game FPS nhưng không hi sinh độ rõ của phép đo.

---

## 8. Tối ưu web điện thoại và toàn màn hình

- Thiết kế mobile-first, hỗ trợ dọc/ngang, không tràn ngang.
- Dùng `100dvh` kèm fallback; xử lí `env(safe-area-inset-top)` và `env(safe-area-inset-bottom)`.
- Khi xoay màn hình hoặc thanh địa chỉ Safari thay đổi, cập nhật renderer/camera.
- Nút quan trọng không bị thanh trình duyệt hoặc home indicator che.
- Dùng Fullscreen API khi trình duyệt hỗ trợ.
- Trên iPhone/Safari nếu không thể fullscreen phần tử web theo cách mong muốn, cung cấp `Chế độ mở rộng`: ẩn header/panel không cần thiết và mở rộng canvas trong vùng khả dụng.
- Có nút thoát rõ ràng; không báo đã fullscreen nếu API thất bại.
- Mục tiêu 30–60 FPS tùy thiết bị; ưu tiên tương tác ổn định hơn hiệu ứng nặng.
- Không render lại toàn bộ React ở mỗi frame; dùng animation loop/refs.
- Giảm render khi tab nền; giải phóng tài nguyên WebGL khi rời trang.
- Không phụ thuộc tài nguyên 3D ngoài máy chủ nếu có thể dựng bằng geometry/material tại chỗ.
- Có thông báo nếu WebGL không khả dụng và chế độ 2D giản lược nếu triển khai được.


### 8.1. Tiêu chí hiển thị sắc nét, độ phân giải cao

Yêu cầu này áp dụng trực tiếp cho điện thoại có màn hình Retina/HiDPI và màn hình Android mật độ điểm ảnh cao. Không được chỉ phóng to một canvas độ phân giải thấp bằng CSS.

#### Chất lượng kết xuất 3D
- Renderer phải đo đúng kích thước CSS thực của vùng canvas và cập nhật kích thước khi đổi hướng màn hình, ẩn/hiện panel, mở rộng vùng mô phỏng hoặc Safari thay đổi chiều cao viewport.
- Dùng `ResizeObserver` khi thích hợp, kết hợp sự kiện resize/orientation để cập nhật renderer và camera; tránh tạo nhiều listener trùng lặp.
- Hỗ trợ mật độ điểm ảnh của thiết bị bằng `renderer.setPixelRatio(...)`, nhưng đặt giới hạn thích ứng để tránh dùng quá nhiều bộ nhớ GPU. Mặc định có thể dùng `min(devicePixelRatio, 2)` trên điện thoại; cho phép mức High lên đến khoảng 2.5 trên thiết bị đủ mạnh. Không bắt buộc kết xuất 4K trên mọi điện thoại.
- Sau mỗi lần resize, cập nhật `renderer.setSize(width, height, false)` và camera aspect/projection matrix; giữ đúng tỉ lệ, không kéo giãn vật thể.
- Bật khử răng cưa khi cấu hình renderer hỗ trợ; nếu dùng post-processing, không làm chữ, vạch chia, cạnh dụng cụ hoặc màn hình đồng hồ bị nhòe.
- Thiết lập màu đầu ra và tone mapping nhất quán để màu kim loại, nhựa và màn hình không bị bạc màu hoặc cháy sáng. Không tăng exposure/bloom quá mức.
- Không dùng texture độ phân giải thấp cho số trên đồng hồ, nhãn vật thể hoặc các thông số đo. Ưu tiên chữ UI HTML/CSS hoặc SVG sắc nét thay cho chữ nhỏ vẽ trực tiếp trên texture 3D.
- Các vạch chia thước, đầu nối, khe cổng quang, vít chỉnh, cạnh trụ thép và nút công tắc phải nhận diện được khi phóng to. Chi tiết nhỏ không được chỉ là các chấm/texture giả nếu chức năng cần thao tác.
- Chỉ dùng vật liệu/texture có độ phân giải tương xứng với kích thước hiển thị; lọc texture phù hợp, tránh răng cưa và nhấp nháy khi camera di chuyển.
- Không dùng motion blur hoặc depth of field làm mờ đồng hồ số, cổng quang điện, điểm đo hay vật thể đang cần quan sát.

#### Chất lượng UI trên màn hình nhỏ
- UI chính phải được dựng bằng DOM/CSS hoặc SVG sắc nét, không raster hóa toàn bộ giao diện thành ảnh nền.
- Nội dung thông thường nên có cỡ chữ tối thiểu khoảng 14–16 CSS px; thông số quan trọng và số đo đồng hồ nên từ 18 CSS px trở lên khi không gian cho phép.
- Nút chính có vùng chạm mục tiêu tối thiểu khoảng 44 × 44 CSS px. Khoảng cách giữa các nút đủ lớn để tránh bấm nhầm.
- Các nút `Nhả trụ thép`, `RESET`, `Đặt lại`, và trạng thái đồng hồ phải dễ tìm, không chỉ phân biệt bằng màu sắc; bổ sung nhãn/icon có ý nghĩa.
- Đảm bảo độ tương phản đủ cao giữa chữ và nền. Không đặt chữ trắng nhỏ lên vùng phản chiếu sáng hoặc chữ tối trên vật thể tối.
- Mọi nhãn quan trọng phải duy trì khả năng đọc ở cả chế độ dọc và ngang; cho phép ẩn nhãn phụ để nhường chỗ nhưng không ẩn trạng thái an toàn/lỗi cần thiết.
- Bảng số liệu và đồ thị trên điện thoại phải dùng bố cục thích ứng: bảng có cuộn ngang riêng bên trong panel nếu cần, không làm tràn ngang toàn trang; các giá trị cốt lõi vẫn phải xem được.
- Không để bảng điều khiển che mất trụ thép, đầu nam châm điện hoặc khe cổng quang. Khi mở panel, có thể tự điều chỉnh camera/khung hình hoặc thu gọn panel.
- Khi bật chế độ `Ẩn giao diện`, chỉ giữ một nút gọi lại nhỏ, dễ chạm và luôn nằm trong safe area.

#### Thiết lập chất lượng thích ứng
Cung cấp các mức chất lượng sau trong cài đặt:
- **Tự động:** chọn cấu hình dựa trên khả năng thiết bị và tốc độ khung hình.
- **Cao:** mật độ điểm ảnh cao hơn, vật liệu/ánh sáng tốt hơn khi thiết bị đáp ứng.
- **Cân bằng:** giảm bóng, post-processing và mật độ render khi cần giữ tương tác mượt.
- **Tiết kiệm pin:** giảm hiệu ứng nặng, hạ mật độ render nhưng giữ UI và chữ sắc nét.

Có thể giảm độ phân giải kết xuất nội bộ theo thời gian nếu FPS liên tục thấp; tăng lại từ từ khi hiệu năng ổn định. Không thay đổi kích thước CSS của canvas để giả lập giảm độ phân giải. UI chữ/số vẫn phải giữ độ sắc nét dù chất lượng 3D được hạ.

Mục tiêu hiệu năng là trải nghiệm ổn định khoảng 30–60 FPS tùy thiết bị. Nếu phải chọn giữa bóng đổ đẹp và thao tác mượt, ưu tiên thao tác mượt; nếu giảm chất lượng 3D, không được làm giảm khả năng đọc màn hình đồng hồ hoặc nhãn thiết bị.

#### Kiểm tra trực quan theo kích thước màn hình
Ít nhất phải đánh giá các nhóm viewport đại diện:
- Điện thoại nhỏ ở chế độ dọc.
- Điện thoại màn hình lớn/Retina ở chế độ dọc.
- Điện thoại ở chế độ ngang.
- Máy tính bảng.
- Màn hình laptop/desktop.

Kiểm tra ở mức zoom trình duyệt mặc định và khi người dùng phóng to trang. Không tuyên bố đã kiểm tra trên iPhone/Android thật nếu chỉ mới kiểm tra bản preview hoặc trình giả lập; phải nêu rõ môi trường đã kiểm tra.

---

## 9. Bảng số liệu và đồ thị

### Bảng
- 5 quãng đường \(s_1...s_5\).
- Mỗi quãng đường tối đa 5 lần đo.
- Lưu thời gian \(t\), \(t^2\) và giá trị \(g\) theo phương pháp đã chọn.
- Có `Ghi kết quả`, `Xóa lần đo`, `Xuất CSV`, `Xóa bảng` (có xác nhận).
- Không tự điền dữ liệu trước khi đo.

### Đồ thị
- Trục x: \(t^2\) (s²).
- Trục y: \(s\) (m).
- Vẽ điểm dữ liệu đã ghi và đường hồi quy khi đủ điểm.
- Hiển thị hệ số góc \(k\), tính \(g=2k\).
- Cho phép bật/tắt đường xu hướng.
- Không mặc định ép hồi quy đi qua gốc nếu chưa có lựa chọn rõ.
- Trục, đơn vị, chú giải đọc được trên điện thoại.

---

## 10. Chế độ học tập

### Hướng dẫn
Đánh dấu các thiết bị theo thứ tự; hướng dẫn căn chỉnh, reset, nhả trụ thép và đọc số liệu. Có thể bật tia quang minh họa và đường rơi.

### Thực hành tự do
Học sinh tự đặt quãng đường, đo nhiều lần, ghi dữ liệu và xem đồ thị. Có thể ẩn hoàn toàn hướng dẫn.

### Câu hỏi sau thực hành
1. Vì sao nên dùng cùng một trụ thép trong các lần đo?
2. Vì sao phải căn chỉnh cổng quang điện với đường rơi?
3. Vì sao thời gian rơi tăng khi quãng đường tăng?
4. Đồ thị \(s\) theo \(t^2\) cho biết gì?
5. Nêu các nguồn sai số trong thí nghiệm thật.
6. Mô phỏng lí tưởng khác thiết bị thật ở điểm nào?

---

## 11. Bộ kiểm thử nghiệm thu

**TEST A — Công thức:** với \(g=9{,}81\ \mathrm{m/s^2}\), \(s=0{,}50\ \mathrm m\), thời gian lí tưởng \(t=\sqrt{2s/g}\approx0{,}319\ \mathrm s\). Sai số số học mục tiêu dưới 1% ở cấu hình chuẩn.

**TEST B — Tăng quãng đường:** \(s\) tăng thì \(t\) tăng theo căn bậc hai, không tăng tuyến tính theo \(s\).

**TEST C — Lặp lại lí tưởng:** cùng \(s,g\) phải cho cùng \(t\) trong giới hạn sai số số học.

**TEST D — Nhả trụ thép:** khi nam châm giữ, trụ thép đứng yên; khi ngắt dòng, trụ thép rơi và đồng hồ bắt đầu.

**TEST E — Cổng quang:** đồng hồ chỉ dừng khi trụ thép chắn tia; cổng lệch thì không dừng.

**TEST F — Reset:** đồng hồ về 0; dữ liệu đã ghi vẫn tồn tại trừ khi xóa bảng riêng.

**TEST G — Dịch cổng:** thay đổi vị trí cổng phải cập nhật \(s\), thời gian và thước cùng lúc.

**TEST H — Đồ thị:** dữ liệu lí tưởng cho đường gần thẳng với hệ số góc \(g/2\); \(g=2k\).

**TEST I — Đơn vị:** không trộn m với cm hoặc s với ms; không có NaN/Infinity/chia 0.

**TEST J — Lỗi:** thiếu nguồn, chưa reset, bi không được giữ hoặc cổng lệch phải được xử lí; không tạo số đo giả.

**TEST K — Điện thoại:** cảm ứng hoạt động, camera không xung đột với kéo thiết bị, panel ẩn/hiện không reset, xoay màn hình không làm hỏng bố cục, chế độ mở rộng thoát được.

**TEST L — Chất lượng:** dây gắn đúng cọc, khe cổng nhìn rõ, số đồng hồ đọc được, không xuyên vật thể, toàn bộ bộ dụng cụ nằm trong khung.

**TEST M — Độ sắc nét HiDPI:** trên viewport có `devicePixelRatio > 1`, canvas kết xuất ở mật độ điểm ảnh thích hợp, không bị kéo giãn/nhòe sau resize; UI, vạch thước và số đồng hồ vẫn sắc nét.

**TEST N — Dọc/ngang và panel:** khi xoay điện thoại, mở/đóng panel hoặc vào/thoát chế độ mở rộng, canvas/camera được resize đúng; không cắt dụng cụ, không méo vật thể và không có thanh cuộn ngang toàn trang.

**TEST O — Khả năng đọc:** chữ hướng dẫn chính ≥ 14 CSS px khi bố cục cho phép; số đo quan trọng đủ lớn để đọc trên màn hình điện thoại; các nút chính có vùng chạm khoảng 44 × 44 CSS px trở lên; tương phản rõ.

**TEST P — Chất lượng thích ứng:** khi FPS giảm, mô phỏng hạ bóng/post-processing hoặc render scale trước khi làm chậm thao tác; UI số liệu không bị làm mờ theo độ phân giải 3D.

**TEST Q — Safe area:** trên bố cục iPhone, nút ẩn/hiện giao diện và nút thoát chế độ mở rộng không bị tai thỏ, thanh trạng thái hoặc Home Indicator che khuất.

---

## 12. Nguồn khoa học tham khảo

Các nguồn sau dùng để đối chiếu nguyên lí thí nghiệm; chúng không nhất thiết mô tả đúng model thiết bị trong ảnh SGK:

1. University of Iowa — Free-Fall Apparatus:  
   https://instructional-resources.physics.uiowa.edu/1c3016-free-fall-apparatus
2. Southern Methodist University — Timed Free Fall:  
   https://www.demos.smu.ca/demos/mechanics/129-timed-free-fall
3. PASCO — Freefall Adapter:  
   https://www.pasco.com/products/sensors/acceleration-and-freefall/me-9207
4. Vernier — Photogate:  
   https://www.vernier.com/product/photogate/
5. Institute of Physics, IOP Spark — Measurement of \(g\) using an electronic timer:  
   https://spark.iop.org/measurement-g-using-electronic-timer

Không sao chép logo/hình ảnh độc quyền nếu không cần thiết. Mục tiêu là một bộ dụng cụ giáo dục điển hình đúng chức năng.

---

## 13. Kiến trúc phần mềm đề xuất

Tách biệt:
- `PhysicsModel`: tính vị trí, vận tốc, thời gian và gia tốc.
- `ExperimentStateMachine`: quản lí trạng thái thiết bị và phép đo.
- `Apparatus3D`: giá đỡ, nam châm điện, trụ thép, cổng quang, đồng hồ, công tắc, dây và thước.
- `InteractionController`: raycasting, kéo kẹp, cảm ứng, camera.
- `ControlPanels`: điều khiển, dữ liệu, đồ thị, hướng dẫn.
- `MeasurementStore`: lưu phép đo, xuất CSV.
- `Tests`: kiểm thử mô hình, state machine và responsive UI.

Không để hoạt ảnh tự tạo thời gian độc lập với mô hình vật lí. Đồng hồ, vị trí trụ thép, dữ liệu và đồ thị phải cùng xuất phát từ một nguồn trạng thái thống nhất.

---

## 14. Thứ tự triển khai

1. Dựng bộ dụng cụ và state machine.
2. Xây dựng trụ thép rơi theo công thức, đồng hồ bắt đầu/dừng đúng sự kiện.
3. Cho phép chỉnh cổng quang và đồng bộ quãng đường.
4. Thêm bảng số liệu, tính toán và đồ thị.
5. Hoàn thiện vật liệu, ánh sáng, camera, cận cảnh.
6. Thêm panel ẩn/hiện và tối ưu cảm ứng/điện thoại.
7. Chạy kiểm thử khoa học, sửa lỗi và ghi rõ giới hạn.

---

## 15. Lệnh triển khai trong Google AI Studio Build

Sau khi đính kèm file này, dán lệnh:

> Đọc toàn bộ `BAI_11_DO_GIA_TOC_ROI_TU_DO_3D_SPEC_V3.md` và xây dựng ứng dụng web 3D tương tác hoàn chỉnh theo đặc tả. Dùng React + TypeScript + Three.js nếu tương thích với môi trường hiện tại. Ưu tiên đúng chức năng thiết bị và mô hình vật lí trước hiệu ứng trang trí. Phải có nam châm điện nhả trụ thép, cổng quang điện phát hiện trụ thép, đồng hồ bắt đầu/dừng đúng sự kiện, điều chỉnh quãng đường, bảng số liệu và đồ thị \(s\) theo \(t^2\). Các thanh công cụ phải ẩn/hiện được để tối đa hóa vùng 3D; hỗ trợ cảm ứng, xoay màn hình và chế độ mở rộng phù hợp với Safari iPhone. Bắt buộc kết xuất HiDPI sắc nét, cập nhật renderer/camera bằng kích thước thật của canvas, giới hạn devicePixelRatio hợp lí, UI chữ/vector sắc nét, chữ và số đo dễ đọc, nút đủ lớn và có chất lượng đồ họa thích ứng để không làm nóng máy hoặc giảm FPS quá mức. Không chỉ tạo giao diện tĩnh hoặc mã giả. Hãy chạy ứng dụng, kiểm tra các phép thử nghiệm thu trong file, sửa lỗi có thể tái hiện và báo trung thực các chức năng đã kiểm thử, chưa kiểm thử cùng các giả định/giới hạn còn lại. Không tuyên bố đã kiểm thử nếu chưa thực sự kiểm tra.
