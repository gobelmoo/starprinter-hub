************************************************************
      php_queue Ver 2.0.0                  22/12/2023
         Readme_Jp.txt                  スター精密（株）
************************************************************

    1. 概要
    2. 内容
    3. 適用
    4. 使用例
    5. 著作権
    6. 変更履歴

==========
 1. 概要
==========

    本サンプルは、サーバーがホストするPHP 言語とSQLiteに基づくCloudPRNTサーバーサンプルです。

    印刷について、すべての印刷ジョブはStarドキュメントマークアップ言語で書かれたデータを使用して作成されます。
    このデータは、CPUtliユーティリティを利用することで、各CloudPRNTプリンタでサポートされているメディア形式に変換されます。

    これにより１つの入力形式の印刷ジョブデータで、各デバイスコマンドエミュレーションや印刷幅毎のデータを生成し、
    各CloudPRNTプリンタでの印刷をサポートできます。

    尚、このデモンストレーションは基本的なものであり、セキュリティ、顧客への通知、
    および実際の展開に必要なその他の配慮すべき事項等は考慮されていません。

    CloudPRNT / Starドキュメントマークアップ / CPUtilの詳細な説明は、SDKドキュメントを参照ください。
    (https://www.star-m.jp/products/s_print/sdk/StarCloudPRNT/manual/ja/index.html)


==========
 2. 内容
==========

    php_queue_v200
    |- Readme_En.txt                          // リリースノート (英語)
    |- Readme_Jp.txt                          // リリースノート (日本語)
    |- SoftwareLicenseAgreement.pdf           // ソフトウエア使用許諾書 (英語)
    |- SoftwareLicenseAgreement_Jp.pdf        // ソフトウエア使用許諾書 (日本語)
    |
    +- php_queue
       |- cloudprnt.php                       // CPUtilの使用を含むCloudPRNTキューシステムのPHP言語サンプル
       |- cpphp.css                           // mangament.html / print.htmlのスタイルシート
       |- cputil.php                          // CPUtilに関する関数をまとめたサンプル
       |- devices.php                         // データベースの照会、デバイス情報のキューの管理のサンプル
       |- management.html                     // プリンタおよび印刷ジョブのためのキュー登録/閲覧の管理ページ
       |- print.html                          // 登録済プリンタ用の簡易印刷ボタンWebページ
       |- print.php                           // データベースの照会、印刷ジョブの構成と印刷トリガー(management.html / print.html間の管理)のサンプル
       |- queues.php                          // データベースの照会、印刷ジョブデータ情報のキューの管理のサンプル
       |- simplequeue.sqlite                  // cloudprnt.php devices.php / print.php / queues.phpで使用されるデータベースファイル
       |- cloudprnt-setting.json              // (CloudPRNT Version MQTT) プリンターからのサーバー設定情報取得リクエストに対してレスポンスするJSONデータ
       |- management.php                      // (CloudPRNT Version MQTT) 管理ページからプリンター向けMQTTメッセージの発行をトリガーするためのサンプル
       |- mqtt_handle_received_message.php    // (CloudPRNT Version MQTT) プリンターからCloudPRNTサーバー向けに発行されたメッセージを処理するためのサンプル
       |- mqtt_publish.php                    // (CloudPRNT Version MQTT) プリンター向けMQTTメッセージを作成、発行するためのサンプル
       |- mqtt_subscribe.ps1                  // (CloudPRNT Version MQTT) Windows用 : CloudPRNTサーバー向けMQTTメッセージを購読し、受信したメッセージを引数にcloudprnt.phpを実行するサンプル
       |- mqtt_subscribe.sh                   // (CloudPRNT Version MQTT) Linux Ubuntu用 : CloudPRNTサーバー向けMQTTメッセージを購読し、受信したメッセージを引数にcloudprnt.phpを実行するサンプル
       +- js
       |  |- jquery-3.3.1.min.js              // jquery 3.3.1 JavaScript library
       |  +- management.js                    // management.htmlの情報更新のためのJavaScript
       +- cloudprnt-setting_Sample            // (CloudPRNT Version MQTT) サーバー設定情報取得リクエストに対するレスポンスJSONのサンプル
          |-cloudprnt-setting_http.json              // CloudPRNT Version HTTP 用構成サンプル 
          |-cloudprnt-setting_mqtt_triggerpost.json  // CloudPRNT Version MQTT (Trigger POST) 用構成サンプル 
          +-cloudprnt-setting_mqtt.json              // CloudPRNT Version MQTT (Full MQTT / Pass URL) 用構成サンプル 

==========
 3. 適用
==========

    下記のCloudPRNTクライアント対応プリンタを対象としています。:
        - mC-Print2
        - mC-Print3
        - TSP100IV
        - TSP100IV SK
        - mC-Label3

    CloudPRNTについての詳細は、SDKドキュメントを参照ください。
    (https://www.star-m.jp/products/s_print/sdk/StarCloudPRNT/manual/ja/index.html)

    CloudPRNT Version MQTT対応プリンターについては、SDKドキュメントの以下のセクションを参照ください。
    (https://www.star-m.jp/products/s_print/sdk/StarCloudPRNT/manual/ja/index.html#compatiblePrinters)

=============
 4. 使用例
=============
    このサンプルプロジェクトは、PHPやSQLiteライブラリを含むサーバーでホストされた後に利用できます。

    サーバーのセットアップ及び本サンプルの配置後、ブラウザで http://<Server Specified Path>/management.html にアクセスすることでテストできます。

    本サンプルの詳細は、SDKドキュメントを参照ください。
    (https://www.star-m.jp/products/s_print/sdk/StarCloudPRNT/manual/ja/test.html)


===========
 5. 著作権
===========

    スター精密（株）Copyright 2019 - 2023


=============
 6. 変更履歴
=============

    Ver.1.0.0
    2019/11/05:
        初版リリース

    Ver.1.1.0
    2020/06/17:
        management.htmlにてプリンタのMACアドレス登録時、大文字入力を許容するように変更

    Ver.2.0.0
    2023/12/22:
        CloudPRNT Version MQTTに対応
