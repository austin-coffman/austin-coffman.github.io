$(function() {
    var data = [
      { 
            action: 'type',
            strings: ['hi there, need a developer?', '', 'hrm.. let me show you my work', '', '<br>'],
            postDelay: 1000
        },
        
        { 
            action: 'type',
            strings: ["ls -l^400"],
            output: [$('.ls-output').html()],
            postDelay: 2000
        },
        {
            action: 'type',
            strings: [ 'actually, the mood just isn\'t quite <i>right...</i>', ''],
            postDelay: 1000
        },
        {
            action: 'type',
            strings: ['./make-it-rain.sh^400'],
            output: ['<script> $("#rain-container").removeClass("disabled")</script><br>'],
            postDelay: 2500
        },
        {
            action: 'type',
            strings: ['ahh, very relaxing', ''],
            postDelay: 1000
        },
        { 
            action: 'type',
            strings: ["cd Projects/my-portfolio^400"],
            output: [''],
            postDelay: 500
        },
        { 
            action: 'type',
            //clear: true,
            strings: ['make web^400'],
            output: [
                'docker-compose run --rm install',
                'Creating my-portfolio ... <span class="green">done</span>',
                '<br>',
                'up to date, audited 4263 packages in 2s',
                'found <span class="red">42</span> vulnerabilities (8 <span class="gray">low</span>, 6 <span class="yellow">moderate</span>, 21 <span class="red">high</span>, 7 <span class="purple">critical</span>)',
                '<br>',
                'To address issues that do not require attention, run: ',
                '&nbsp; npm audit fix',
                '<br>',
                'To address all issues (including breaking changes), run: ',
                '&nbsp; npm audit fix --force',
                '<br>',
                'Run `npm audit` for details.',
                'npm <span class="blue">notice</span>',
                'npm <span class="blue">notice</span> New major <span class="red">version</span> of npm available! <span class="red">7.5.3</span> -> <span class="green">8.18.0</span>',
                'npm <span class="blue">notice</span> Changelog: <span class="lightblue">https://github.com/npm/cli/releases/tag/v8.18.0</span>',
                'npm <span class="blue">notice</span> Run <span class="green">npm install -g npm@8.18.0</span> to update!',
                'npm <span class="blue">notice</span>',
                'docker-compose up web',
                'my-portfolio is up-to-date',
                'Attaching to my-portfolio',
                '<span class="lightblue">my-portfolio &nbsp;&nbsp; |</span>',
                '<span class="lightblue">my-portfolio &nbsp;&nbsp; |</span> > my-portfolio@0.1.0 start',
                '<span class="lightblue">my-portfolio &nbsp;&nbsp; |</span> > react-scripts start', 
                '<span class="lightblue">my-portfolio &nbsp;&nbsp; |</span> ',
                '<span class="lightblue">my-portfolio &nbsp;&nbsp; |</span> [HPM] Proxy created: /api -> http://docker.for.mac.localhost:5000',
                '<span class="lightblue">my-portfolio &nbsp;&nbsp; |</span> <span class="blue">i</span> <span class="gray">[wds]</span>: Project is running at 192.168.50.1',
                '<span class="lightblue">my-portfolio &nbsp;&nbsp; |</span> <span class="blue">i</span> <span class="gray">[wds]</span>: webpack output is served from',
                '<span class="lightblue">my-portfolio &nbsp;&nbsp; |</span> <span class="blue">i</span> <span class="gray">[wds]</span>: Content not from webpack is served from /usr/src/public',
                '<span class="lightblue">my-portfolio &nbsp;&nbsp; |</span> <span class="blue">i</span> <span class="gray">[wds]</span>: 404s will fallback to /',
                '<span class="lightblue">my-portfolio &nbsp;&nbsp; |</span> Starting the development server..',
                '<span class="lightblue">my-portfolio &nbsp;&nbsp; |</span>',
                '<span class="lightblue">my-portfolio &nbsp;&nbsp; |</span>',
                '<span class="lightblue">my-portfolio &nbsp;&nbsp; |</span>',
                '<span class="lightblue">my-portfolio &nbsp;&nbsp; |</span>',
                '<span class="lightblue">my-portfolio &nbsp;&nbsp; |</span>',
                '<span class="lightblue">my-portfolio &nbsp;&nbsp; |</span>',
                '<span class="lightblue">my-portfolio &nbsp;&nbsp; |</span> You can now view my-portfolio in the browser.',
                '<span class="lightblue">my-portfolio &nbsp;&nbsp; |</span> &nbsp; Local: &nbsp;&nbsp;&nbsp;&nbsp; http://localhost:3000',
                '<span class="lightblue">my-portfolio &nbsp;&nbsp; |</span> &nbsp; On Your Network: <span class="yellow">https://austin-coffman.github.io/</span>',
                '<span class="lightblue">my-portfolio &nbsp;&nbsp; |</span>',
                '<span class="lightblue">my-portfolio &nbsp;&nbsp; |</span>',
                '<span class="lightblue">my-portfolio &nbsp;&nbsp; |</span>',
                '<span class="lightblue">my-portfolio &nbsp;&nbsp; |</span>',
                '<span class="lightblue">my-portfolio &nbsp;&nbsp; |</span> Redirecting...',
                '<br>'
            ],
            outputDelay: 200,
            postDelay: 13000
        },
        { 
          action: 'type',
          strings: ['<br>'],
          output: ['<script> $("#popup-window").removeClass("disabled")</script><br>'],
          postDelay: 3300
        },
    
  ];
    runScripts(data, 0);
  });
  
  function runScripts(data, pos) {
      var prompt = $('.prompt'),
          script = data[pos];
      if(script.clear === true) {
        $('.history').html(''); 
      }
      switch(script.action) {
          case 'type':
            // cleanup for next execution
            prompt.removeData();
            $('.typed-cursor').text('');
            prompt.typed({
              strings: script.strings,
              typeSpeed: 60,
              callback: function() {
                var history = $('.history').html();
                history = history ? [history] : [];
                history.push('$ ' + prompt.text());
                if(script.output) {
                    script.output.forEach( function(element, index) {
                        if (script.outputDelay){

                            var outputText = new Promise(function(resolve, reject) {
                                setTimeout(function a(){ 
                                    history.push(element);
                                    prompt.html('');
                                    $('.history').html(history.join('<br>'));
                                    $('section.terminal').scrollTop($('#history').height());
                                }, script.outputDelay*(index+1));
                            })

                            var removeShell = new Promise(function(resolve, reject){
                                setTimeout(function shell(){
                                    $("#shell").addClass("disabled")
                                }, script.outputDelay)
                            })
                            
                            var addShell = new Promise(function(resolve, reject) {
                                setTimeout(function b(){ 
                                    $("#shell").removeClass("disabled")
                                }, script.outputDelay* (script.output.length+1));
                            })

                            var scrollToEnd = new Promise(function(resolve, reject){
                              $('section.terminal').scrollTop($('#history').height());
                            })
                            
                        
                            Promise.all([removeShell, outputText, addShell, scrollToEnd]).then(function() {
                               
                            });
                            
                        } else {
                            history.push(element);
                            prompt.html('');
                            $('.history').html(history.join(''));
                        }
                        
                    }); 
                }
                // scroll to bottom of screen
                $('section.terminal').scrollTop($('#history').height());
                // Run next script
                pos++;
                if(pos < data.length) {
                  setTimeout(function() {
                    runScripts(data, pos);
                  }, script.postDelay || 1000);
                }
              }
            });
            break;
          case 'view':
  
            break;
      }
  }

  $(function(){

 

  var makeItRain = function() {
    //clear out everything
    $('.rain').empty();
  
    var increment = 0;
    var drops = "";
    var backDrops = "";
  
    while (increment < 100) {
      //couple random numbers to use for various randomizations
      //random number between 98 and 1
      var randoHundo = (Math.floor(Math.random() * (98 - 1 + 1) + 1));
      //random number between 5 and 2
      var randoFiver = (Math.floor(Math.random() * (5 - 2 + 1) + 2));
      //increment
      increment += randoFiver;
      //add in a new raindrop with various randomizations to certain CSS properties
      drops += '<div class="drop" style="left: ' + increment + '%; bottom: ' + (randoFiver + randoFiver - 1 + 100) + '%; animation-delay: 0.' + randoHundo + 's; animation-duration: 0.5' + randoHundo + 's;"><div class="stem" style="animation-delay: 0.' + randoHundo + 's; animation-duration: 0.5' + randoHundo + 's;"></div><div class="splat" style="animation-delay: 0.' + randoHundo + 's; animation-duration: 0.5' + randoHundo + 's;"></div></div>';
      backDrops += '<div class="drop" style="right: ' + increment + '%; bottom: ' + (randoFiver + randoFiver - 1 + 100) + '%; animation-delay: 0.' + randoHundo + 's; animation-duration: 0.5' + randoHundo + 's;"><div class="stem" style="animation-delay: 0.' + randoHundo + 's; animation-duration: 0.5' + randoHundo + 's;"></div><div class="splat" style="animation-delay: 0.' + randoHundo + 's; animation-duration: 0.5' + randoHundo + 's;"></div></div>';
    }
  
    $('.rain.front-row').append(drops);
    $('.rain.back-row').append(backDrops);
  }
  
  $('.splat-toggle.toggle').on('click', function() {
    $('body').toggleClass('splat-toggle');
    $('.splat-toggle.toggle').toggleClass('active');
    makeItRain();
  });
  
  $('.back-row-toggle.toggle').on('click', function() {
    $('body').toggleClass('back-row-toggle');
    $('.back-row-toggle.toggle').toggleClass('active');
    makeItRain();
  });
  
  $('.single-toggle.toggle').on('click', function() {
    $('body').toggleClass('single-toggle');
    $('.single-toggle.toggle').toggleClass('active');
    makeItRain();
  });
  
  makeItRain();
})